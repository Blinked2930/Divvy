export interface MemberBalance {
  memberId: string;
  name: string;
  netALL: number; // positive = owed money, negative = owes money
}

export interface SimplifiedDebt {
  fromMemberId: string;
  fromName: string;
  toMemberId: string;
  toName: string;
  amountALL: number;
}

export interface DirectPairDebt {
  fromMemberId: string;
  fromName: string;
  toMemberId: string;
  toName: string;
  amount: number;
}

export interface DebtTransferStep {
  debtorId: string;
  debtorName: string;
  creditorId: string;
  creditorName: string;
  amount: number;
  debtorRemainingAfter: number;
  creditorRemainingAfter: number;
}

export interface MemberMathLedger {
  memberId: string;
  name: string;
  netBalance: number;
  items: Array<{
    id: string;
    label: string;
    date?: number;
    delta: number; // + increases what member is owed / reduces what member owes; - decreases
    kind: 'expense_paid' | 'expense_share' | 'settlement_out' | 'settlement_in';
  }>;
}

/**
 * Calculates net balance for every member in a group based on expenses and settlements.
 */
export function calculateBalances(
  members: Array<{ _id: string; name: string }>,
  expenses: Array<{
    amountInALL: number;
    paidByMemberId: string;
    splits: Array<{ memberId: string; amountALL: number }>;
  }>,
  settlements: Array<{
    fromMemberId: string;
    toMemberId: string;
    amountALL: number;
  }>
): Map<string, number> {
  const balances = new Map<string, number>();

  members.forEach((m) => balances.set(m._id, 0));

  expenses.forEach((exp) => {
    const currentPayerBalance = balances.get(exp.paidByMemberId) ?? 0;
    balances.set(exp.paidByMemberId, currentPayerBalance + exp.amountInALL);

    exp.splits.forEach((split) => {
      const currentSplitterBalance = balances.get(split.memberId) ?? 0;
      balances.set(split.memberId, currentSplitterBalance - split.amountALL);
    });
  });

  settlements.forEach((s) => {
    const fromBal = balances.get(s.fromMemberId) ?? 0;
    balances.set(s.fromMemberId, fromBal + s.amountALL);

    const toBal = balances.get(s.toMemberId) ?? 0;
    balances.set(s.toMemberId, toBal - s.amountALL);
  });

  return balances;
}

/**
 * Computes raw (un-simplified) direct pairwise debts before netting/simplification.
 * Each expense split participant owes their split share to the payer, netted directly
 * between each pair (A -> B vs B -> A) and reduced by direct settlements.
 */
export function calculateDirectPairwiseDebts(
  members: Array<{ _id: string; name: string }>,
  expenses: Array<{
    _id?: string;
    title?: string;
    amount: number;
    amountInGroupCurrency?: number;
    amountInALL: number;
    currency?: string;
    paidByMemberId: string;
    splits: Array<{ memberId: string; amountGroup?: number; amountALL: number }>;
  }>,
  settlements: Array<{
    _id?: string;
    fromMemberId: string;
    toMemberId: string;
    amount?: number;
    amountInGroupCurrency?: number;
    amountALL: number;
    currency?: string;
  }>,
  getSplitAmount: (split: any, exp: any) => number,
  getSettlementAmount: (set: any) => number
): DirectPairDebt[] {
  const nameMap = new Map(members.map((m) => [m._id, m.name]));
  const directed = new Map<string, Map<string, number>>();

  const addDirected = (fromId: string, toId: string, amt: number) => {
    if (fromId === toId || amt <= 0) return;
    if (!directed.has(fromId)) directed.set(fromId, new Map());
    const inner = directed.get(fromId)!;
    inner.set(toId, (inner.get(toId) ?? 0) + amt);
  };

  for (const exp of expenses) {
    const payerId = exp.paidByMemberId;
    for (const split of exp.splits) {
      if (split.memberId === payerId) continue;
      const share = getSplitAmount(split, exp);
      addDirected(split.memberId, payerId, share);
    }
  }

  for (const set of settlements) {
    const amt = getSettlementAmount(set);
    const currentOwed = directed.get(set.fromMemberId)?.get(set.toMemberId) ?? 0;
    if (currentOwed >= amt) {
      directed.get(set.fromMemberId)!.set(set.toMemberId, currentOwed - amt);
    } else {
      directed.get(set.fromMemberId)?.set(set.toMemberId, 0);
      addDirected(set.toMemberId, set.fromMemberId, amt - currentOwed);
    }
  }

  const visited = new Set<string>();
  const result: DirectPairDebt[] = [];

  for (const a of members) {
    for (const b of members) {
      if (a._id === b._id) continue;
      const pairKey = [a._id, b._id].sort().join('::');
      if (visited.has(pairKey)) continue;
      visited.add(pairKey);

      const aOwesB = directed.get(a._id)?.get(b._id) ?? 0;
      const bOwesA = directed.get(b._id)?.get(a._id) ?? 0;
      const diff = Math.round((aOwesB - bOwesA) * 100) / 100;

      if (diff > 0.01) {
        result.push({
          fromMemberId: a._id,
          fromName: nameMap.get(a._id) ?? 'Member',
          toMemberId: b._id,
          toName: nameMap.get(b._id) ?? 'Member',
          amount: diff,
        });
      } else if (diff < -0.01) {
        result.push({
          fromMemberId: b._id,
          fromName: nameMap.get(b._id) ?? 'Member',
          toMemberId: a._id,
          toName: nameMap.get(a._id) ?? 'Member',
          amount: Math.abs(diff),
        });
      }
    }
  }

  return result;
}

/**
 * Greedy algorithm to simplify pairwise debts and return step-by-step transfer trace.
 */
export function simplifyDebtsWithTrace(
  members: Array<{ _id: string; name: string }>,
  balances: Map<string, number>
): { simplified: SimplifiedDebt[]; steps: DebtTransferStep[] } {
  const memberMap = new Map(members.map((m) => [m._id, m.name]));

  const debtors: { memberId: string; name: string; amount: number }[] = [];
  const creditors: { memberId: string; name: string; amount: number }[] = [];

  balances.forEach((bal, id) => {
    const rounded = Math.round(bal * 100) / 100;
    const name = memberMap.get(id) ?? 'Member';
    if (rounded < -0.01) {
      debtors.push({ memberId: id, name, amount: Math.abs(rounded) });
    } else if (rounded > 0.01) {
      creditors.push({ memberId: id, name, amount: rounded });
    }
  });

  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const simplified: SimplifiedDebt[] = [];
  const steps: DebtTransferStep[] = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];

    const transfer = Math.min(debtor.amount, creditor.amount);
    const amountRounded = Math.round(transfer * 100) / 100;

    debtor.amount = Math.round((debtor.amount - transfer) * 100) / 100;
    creditor.amount = Math.round((creditor.amount - transfer) * 100) / 100;

    if (amountRounded > 0) {
      simplified.push({
        fromMemberId: debtor.memberId,
        fromName: debtor.name,
        toMemberId: creditor.memberId,
        toName: creditor.name,
        amountALL: amountRounded,
      });

      steps.push({
        debtorId: debtor.memberId,
        debtorName: debtor.name,
        creditorId: creditor.memberId,
        creditorName: creditor.name,
        amount: amountRounded,
        debtorRemainingAfter: debtor.amount,
        creditorRemainingAfter: creditor.amount,
      });
    }

    if (debtor.amount < 0.01) i++;
    if (creditor.amount < 0.01) j++;
  }

  return { simplified, steps };
}

export function simplifyDebts(
  members: Array<{ _id: string; name: string }>,
  balances: Map<string, number>
): SimplifiedDebt[] {
  return simplifyDebtsWithTrace(members, balances).simplified;
}

/**
 * Builds an itemized ledger per member whose deltas sum directly to their net balance.
 */
export function buildMemberMathLedgers(
  members: Array<{ _id: string; name: string }>,
  expenses: Array<{
    _id: string;
    title: string;
    timestamp?: number;
    createdAt?: number;
    paidByMemberId: string;
    splits: Array<{ memberId: string; amountALL: number }>;
  }>,
  settlements: Array<{
    _id: string;
    fromMemberId: string;
    toMemberId: string;
    timestamp?: number;
    createdAt?: number;
  }>,
  getExpenseAmount: (exp: any) => number,
  getSplitAmount: (split: any, exp: any) => number,
  getSettlementAmount: (set: any) => number
): MemberMathLedger[] {
  const nameMap = new Map(members.map((m) => [m._id, m.name]));
  const itemsByMember = new Map<string, MemberMathLedger['items']>();
  for (const m of members) itemsByMember.set(m._id, []);

  for (const exp of expenses) {
    const ts = exp.timestamp ?? exp.createdAt;
    const payerId = exp.paidByMemberId;
    const total = getExpenseAmount(exp);
    const payerSplit = exp.splits.find((s) => s.memberId === payerId);
    const payerOwnShare = payerSplit ? getSplitAmount(payerSplit, exp) : 0;

    const payerNetCredit = Math.round((total - payerOwnShare) * 100) / 100;
    if (Math.abs(payerNetCredit) > 0.005 && itemsByMember.has(payerId)) {
      itemsByMember.get(payerId)!.push({
        id: `${exp._id}-paid`,
        label: `Paid "${exp.title}" (fronted for others)`,
        date: ts,
        delta: payerNetCredit,
        kind: 'expense_paid',
      });
    }

    for (const split of exp.splits) {
      if (split.memberId === payerId) continue;
      const share = getSplitAmount(split, exp);
      if (share > 0 && itemsByMember.has(split.memberId)) {
        itemsByMember.get(split.memberId)!.push({
          id: `${exp._id}-share-${split.memberId}`,
          label: `Share of "${exp.title}" (paid by ${nameMap.get(payerId) ?? 'Member'})`,
          date: ts,
          delta: -Math.round(share * 100) / 100,
          kind: 'expense_share',
        });
      }
    }
  }

  for (const set of settlements) {
    const ts = set.timestamp ?? set.createdAt;
    const amt = Math.round(getSettlementAmount(set) * 100) / 100;
    const fromName = nameMap.get(set.fromMemberId) ?? 'Member';
    const toName = nameMap.get(set.toMemberId) ?? 'Member';

    if (itemsByMember.has(set.fromMemberId)) {
      itemsByMember.get(set.fromMemberId)!.push({
        id: `${set._id}-from`,
        label: `Settled to ${toName}`,
        date: ts,
        delta: amt,
        kind: 'settlement_out',
      });
    }
    if (itemsByMember.has(set.toMemberId)) {
      itemsByMember.get(set.toMemberId)!.push({
        id: `${set._id}-to`,
        label: `Received from ${fromName}`,
        date: ts,
        delta: -amt,
        kind: 'settlement_in',
      });
    }
  }

  return members.map((m) => {
    const items = itemsByMember.get(m._id) ?? [];
    const netBalance =
      Math.round(items.reduce((sum, item) => sum + item.delta, 0) * 100) / 100;
    return {
      memberId: m._id,
      name: m.name,
      netBalance,
      items,
    };
  });
}