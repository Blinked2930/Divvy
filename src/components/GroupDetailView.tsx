// Divvy/src/components/GroupDetailView.tsx
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { useUser } from '@clerk/clerk-react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import {
  ArrowLeft,
  Plus,
  Receipt,
  UserPlus,
  Scale,
  ArrowRight,
  Share2,
  Check,
  PieChart,
  Wallet,
  ChevronDown,
  ChevronUp,
  Settings2,
  Users,
  Handshake,
  Trash2,
  UserCheck,
  UserX,
  Crown,
} from 'lucide-react';
import { AddExpenseModal } from './AddExpenseModal';
import { AddMemberModal } from './AddMemberModal';
import { SettleDebtModal } from './SettleDebtModal';
import { GroupSettingsModal } from './GroupSettingsModal';
import {
  simplifyDebtsWithTrace,
  calculateDirectPairwiseDebts,
  buildMemberMathLedgers,
} from '../utils/debtCalculator';
import { fetchExchangeRate, formatCurrency, EXCHANGE_RATES } from '../utils/currencies';

interface GroupDetailViewProps {
  groupId: Id<'groups'>;
  onBack: () => void;
}

type GroupTab = 'transactions' | 'balances';

type GroupTransactionItem =
  | { kind: 'expense'; data: any; timestamp: number }
  | { kind: 'settlement'; data: any; timestamp: number };

function getLinkedUserId(member: any): string | null {
  const raw = member?.userId ?? member?.claimedByUserId;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower === 'unclaimed' || lower === 'none' || lower === 'null' || lower === 'undefined') {
    return null;
  }
  return trimmed;
}

export const GroupDetailView: React.FC<GroupDetailViewProps> = ({ groupId, onBack }) => {
  const details = useQuery((api as any).groups?.getGroupDetails, { groupId });
  const deleteSettlementMutation = useMutation((api as any).groups?.deleteSettlement);
  const claimMemberMutation = useMutation(
    (api as any).groups?.claimMember || (api as any).groups?.claimGroupMember
  );

  const { user } = useUser();
  const clerkUserId = user?.id ?? null;

  const [activeTab, setActiveTab] = useState<GroupTab>('transactions');
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [showSettle, setShowSettle] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showDebtTransfersBreakdown, setShowDebtTransfersBreakdown] = useState(false);
  const [memberFilter, setMemberFilter] = useState<'all' | 'claimed' | 'unclaimed'>('all');
  const [claimingMemberId, setClaimingMemberId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [editingExpense, setEditingExpense] = useState<any | null>(null);
  const [editingSettlement, setEditingSettlement] = useState<any | null>(null);

  const [settleFrom, setSettleFrom] = useState<string | undefined>();
  const [settleTo, setSettleTo] = useState<string | undefined>();
  const [settleAmount, setSettleAmount] = useState<number | undefined>();

  const groupCurrency: string = details?.group?.currency ?? 'ALL';

  const [rate, setRate] = useState<number>(() => {
    const fallback = EXCHANGE_RATES[groupCurrency];
    return fallback ? 1 / fallback : 1;
  });

  useEffect(() => {
    let cancelled = false;
    if (groupCurrency === 'ALL') {
      setRate(1);
      return;
    }
    fetchExchangeRate('ALL', groupCurrency)
      .then((r) => {
        if (!cancelled && typeof r === 'number' && r > 0) {
          setRate(r);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [groupCurrency]);

  const convertALLFallback = useCallback(
    (amountALL: number): number => Math.round(amountALL * rate * 100) / 100,
    [rate]
  );

  const getExpenseGroupAmount = useCallback(
    (exp: any): number => {
      if (typeof exp.amountInGroupCurrency === 'number') return exp.amountInGroupCurrency;
      if (exp.currency === groupCurrency) return exp.amount;
      return convertALLFallback(exp.amountInALL);
    },
    [groupCurrency, convertALLFallback]
  );

  const getSplitGroupAmount = useCallback(
    (split: any, exp: any): number => {
      if (typeof split.amountGroup === 'number') return split.amountGroup;
      if (exp.currency === groupCurrency && exp.amountInALL > 0) {
        return Math.round(((split.amountALL / exp.amountInALL) * exp.amount) * 100) / 100;
      }
      return convertALLFallback(split.amountALL);
    },
    [groupCurrency, convertALLFallback]
  );

  const getSettlementGroupAmount = useCallback(
    (set: any): number => {
      if (typeof set.amountInGroupCurrency === 'number') return set.amountInGroupCurrency;
      if (set.currency === groupCurrency && typeof set.amount === 'number') return set.amount;
      return convertALLFallback(set.amountALL);
    },
    [groupCurrency, convertALLFallback]
  );

  const fmtGroup = useCallback(
    (amountGroup: number, showSign = false): string => {
      return formatCurrency(Math.round(amountGroup * 100) / 100, groupCurrency, showSign);
    },
    [groupCurrency]
  );

  const balancesInGroup = useMemo(() => {
    const map = new Map<string, number>();
    if (!details) return map;

    for (const m of details.members) {
      map.set(m._id, 0);
    }

    for (const exp of details.expenses) {
      const expTotal = getExpenseGroupAmount(exp);
      map.set(exp.paidByMemberId, (map.get(exp.paidByMemberId) ?? 0) + expTotal);
      for (const split of exp.splits) {
        const share = getSplitGroupAmount(split, exp);
        map.set(split.memberId, (map.get(split.memberId) ?? 0) - share);
      }
    }

    for (const set of details.settlements || []) {
      const setAmt = getSettlementGroupAmount(set);
      map.set(set.fromMemberId, (map.get(set.fromMemberId) ?? 0) + setAmt);
      map.set(set.toMemberId, (map.get(set.toMemberId) ?? 0) - setAmt);
    }

    for (const [id, val] of map.entries()) {
      map.set(id, Math.round(val * 100) / 100);
    }

    return map;
  }, [details, getExpenseGroupAmount, getSplitGroupAmount, getSettlementGroupAmount]);

  const directPairwiseDebts = useMemo(() => {
    if (!details) return [];
    return calculateDirectPairwiseDebts(
      details.members,
      details.expenses || [],
      details.settlements || [],
      getSplitGroupAmount,
      getSettlementGroupAmount
    );
  }, [details, getSplitGroupAmount, getSettlementGroupAmount]);

  const { simplified: simplifiedDebts, steps: debtTransferSteps } = useMemo(() => {
    if (!details) return { simplified: [], steps: [] };
    return simplifyDebtsWithTrace(details.members, balancesInGroup);
  }, [details, balancesInGroup]);

  const memberMathLedgers = useMemo(() => {
    if (!details) return [];
    return buildMemberMathLedgers(
      details.members,
      details.expenses || [],
      details.settlements || [],
      getExpenseGroupAmount,
      getSplitGroupAmount,
      getSettlementGroupAmount
    );
  }, [details, getExpenseGroupAmount, getSplitGroupAmount, getSettlementGroupAmount]);

  const memberSpending = useMemo(() => {
    const map = new Map<string, number>();
    if (!details) return map;
    details.members.forEach((m: { _id: string }) => map.set(m._id, 0));
    details.expenses.forEach((exp: any) => {
      const current = map.get(exp.paidByMemberId) ?? 0;
      map.set(exp.paidByMemberId, current + getExpenseGroupAmount(exp));
    });
    return map;
  }, [details, getExpenseGroupAmount]);

  const categoryTotals = useMemo(() => {
    if (!details) return [];
    const totals: Record<string, number> = {};
    let totalSpent = 0;
    details.expenses.forEach((exp: any) => {
      const cat = exp.category?.trim() || 'General';
      const amt = getExpenseGroupAmount(exp);
      totals[cat] = (totals[cat] || 0) + amt;
      totalSpent += amt;
    });
    return Object.entries(totals)
      .map(([category, amount]) => ({
        category,
        amount,
        percentage: totalSpent > 0 ? Math.round((amount / totalSpent) * 100) : 0,
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [details, getExpenseGroupAmount]);

  const totalGroupSpent = useMemo(() => {
    if (!details) return 0;
    return details.expenses.reduce((sum: number, exp: any) => sum + getExpenseGroupAmount(exp), 0);
  }, [details, getExpenseGroupAmount]);

  const mergedTransactions = useMemo<GroupTransactionItem[]>(() => {
    if (!details) return [];
    const expItems: GroupTransactionItem[] = (details.expenses || []).map((exp: any) => ({
      kind: 'expense',
      data: exp,
      timestamp: exp.timestamp ?? exp.createdAt ?? 0,
    }));
    const setItems: GroupTransactionItem[] = (details.settlements || []).map((set: any) => ({
      kind: 'settlement',
      data: set,
      timestamp: set.timestamp ?? set.createdAt ?? 0,
    }));
    return [...expItems, ...setItems].sort((a, b) => b.timestamp - a.timestamp);
  }, [details]);

  if (!details) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-slate-400 font-medium text-sm">
        Loading group...
      </div>
    );
  }

  const { group, members } = details;

  const allowedCurrencies: string[] = (group as any).allowedCurrencies ?? ['ALL', 'EUR', 'USD'];
  const groupStatus: string = (group as any).status ?? 'active';
  const isArchived = groupStatus === 'archived';
  const isOwner = clerkUserId != null && (group as any).createdBy === clerkUserId;

  const claimedMembers = members.filter((m: any) => Boolean(getLinkedUserId(m)));
  const unclaimedMembers = members.filter((m: any) => !getLinkedUserId(m));
  const currentUserAlreadyClaimedInGroup =
    clerkUserId != null && members.some((m: any) => getLinkedUserId(m) === clerkUserId);

  const filteredMembers = members.filter((m: any) => {
    const linked = getLinkedUserId(m);
    if (memberFilter === 'claimed') return Boolean(linked);
    if (memberFilter === 'unclaimed') return !linked;
    return true;
  });

  const handleCopyGroupId = () => {
    navigator.clipboard.writeText(group._id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleQuickSettle = (fromId: string, toId: string, amountGroup: number) => {
    setEditingSettlement(null);
    setSettleFrom(fromId);
    setSettleTo(toId);
    setSettleAmount(amountGroup);
    setShowSettle(true);
  };

  const handleDeleteSettlement = async (e: React.MouseEvent, settlementId: Id<'groupSettlements'>) => {
    e.stopPropagation();
    await deleteSettlementMutation({ settlementId });
  };

  const handleClaimMember = async (memberId: Id<'groupMembers'>) => {
    setClaimingMemberId(memberId);
    try {
      await claimMemberMutation({ groupId, memberId });
    } catch (err) {
      console.error('Failed to claim member:', err);
    } finally {
      setClaimingMemberId(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-32 font-sans">
      <header
        className="w-full sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur-md"
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}
      >
        <div className="max-w-md mx-auto pb-3 px-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onBack}
            className="p-2 -ml-2 rounded-xl text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="text-center min-w-0 flex-1">
            <h2 className="font-bold text-slate-900 text-base truncate">{group.name}</h2>
            <p className="text-[10px] text-slate-400 font-medium">
              {members.length} Members ({claimedMembers.length} claimed · {unclaimedMembers.length}{' '}
              unclaimed) · {group.currency}
              {isArchived && ' · Archived'}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="p-2 rounded-xl text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              title="Group settings"
            >
              <Settings2 className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={handleCopyGroupId}
              className="p-2 -mr-2 rounded-xl text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              title="Copy Invite ID"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Share2 className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 pt-4 space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => {
              setEditingExpense(null);
              setShowAddExpense(true);
            }}
            className="py-3 px-2 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4 text-emerald-400" />
            <span>Expense</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setEditingSettlement(null);
              setSettleFrom(undefined);
              setSettleTo(undefined);
              setSettleAmount(undefined);
              setShowSettle(true);
            }}
            className="py-3 px-2 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Scale className="w-4 h-4" />
            <span>Settle</span>
          </button>
          <button
            type="button"
            onClick={() => setShowAddMember(true)}
            className="py-3 px-2 rounded-2xl bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs border border-slate-200 shadow-sm transition-all flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <UserPlus className="w-4 h-4 text-emerald-600" />
            <span>Person</span>
          </button>
        </div>

        <div className="p-1 rounded-2xl bg-slate-200/80 grid grid-cols-2 text-xs font-bold">
          <button
            type="button"
            onClick={() => setActiveTab('transactions')}
            className={`py-2 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              activeTab === 'transactions'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Receipt className="w-3.5 h-3.5 text-emerald-600" />
            <span>Transactions ({mergedTransactions.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('balances')}
            className={`py-2 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              activeTab === 'balances'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Users className="w-3.5 h-3.5 text-indigo-600" />
            <span>Balances &amp; Members</span>
          </button>
        </div>

        {activeTab === 'transactions' && (
          <>
            <div className="p-4 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="p-2 rounded-xl bg-slate-100 text-slate-700 shrink-0">
                    <Wallet className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                      Total Group Volume
                    </p>
                    <p className="text-base font-black text-slate-900 font-mono truncate">
                      {fmtGroup(totalGroupSpent)}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowBreakdown(!showBreakdown)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-100 cursor-pointer transition-colors shrink-0"
                >
                  <PieChart className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Breakdown</span>
                  {showBreakdown ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>

              {showBreakdown && (
                <div className="pt-3 border-t border-slate-100 space-y-4 animate-in fade-in">
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      Categories
                    </p>
                    {categoryTotals.length === 0 ? (
                      <p className="text-xs text-slate-400 italic">No categorized expenses yet.</p>
                    ) : (
                      categoryTotals.map((cat) => (
                        <div key={cat.category} className="space-y-1">
                          <div className="flex justify-between text-xs font-semibold gap-2">
                            <span className="text-slate-700 truncate">{cat.category}</span>
                            <span className="font-mono text-slate-900 shrink-0">
                              {fmtGroup(cat.amount)} ({cat.percentage}%)
                            </span>
                          </div>
                          <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                              style={{ width: `${cat.percentage}%` }}
                            />
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="space-y-2 pt-2 border-t border-slate-100">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      Total Paid Out Of Pocket
                    </p>
                    {members.map((m: { _id: string; name: string }) => {
                      const paidOut = memberSpending.get(m._id) ?? 0;
                      return (
                        <div key={m._id} className="flex items-center justify-between text-xs py-0.5 gap-2">
                          <span className="font-semibold text-slate-700 truncate">{m.name}</span>
                          <span className="font-mono font-bold text-slate-900 shrink-0">
                            {fmtGroup(paidOut)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 px-1">
                Activity ({mergedTransactions.length})
              </h3>
              {mergedTransactions.length === 0 ? (
                <div className="p-8 rounded-3xl bg-white border border-slate-200 text-center space-y-2">
                  <Receipt className="w-6 h-6 text-slate-300 mx-auto" />
                  <p className="text-xs text-slate-400">
                    No expenses or settlements recorded for this group yet.
                  </p>
                </div>
              ) : (
                mergedTransactions.map((entry) => {
                  if (entry.kind === 'settlement') {
                    const set = entry.data;
                    const fromName =
                      members.find((m: any) => m._id === set.fromMemberId)?.name || 'Someone';
                    const toName =
                      members.find((m: any) => m._id === set.toMemberId)?.name || 'Someone';
                    const nativeAmount = typeof set.amount === 'number' ? set.amount : set.amountALL;
                    const isSameCurrency = set.currency === group.currency;
                    const setGroupAmt = getSettlementGroupAmount(set);

                    return (
                      <div
                        key={set._id}
                        onClick={() => {
                          setEditingSettlement(set);
                          setShowSettle(true);
                        }}
                        className="p-4 rounded-3xl bg-emerald-50/50 border border-emerald-200/80 hover:border-emerald-300 shadow-sm space-y-2 cursor-pointer transition-all"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-9 h-9 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                              <Handshake className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <h4 className="font-bold text-slate-900 text-sm truncate">
                                  {fromName} paid {toName}
                                </h4>
                                <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[10px] font-bold shrink-0">
                                  Settle
                                </span>
                              </div>
                              <p className="text-[10px] text-slate-500 font-medium">
                                Via {set.paidWith || 'Card'} ·{' '}
                                {new Date(set.timestamp).toLocaleDateString()}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <div className="text-right">
                              <div className="font-mono font-bold text-emerald-700 text-sm">
                                {formatCurrency(nativeAmount, set.currency)}
                              </div>
                              {!isSameCurrency && (
                                <div className="font-mono text-[10px] text-slate-400">
                                  ≈ {fmtGroup(setGroupAmt)}
                                </div>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={(e) => handleDeleteSettlement(e, set._id)}
                              className="p-1.5 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                              title="Delete settlement"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  const exp = entry.data;
                  const isSameCurrency = exp.currency === group.currency;
                  const paidByMember =
                    members.find((m: any) => m._id === exp.paidByMemberId)?.name || 'Someone';
                  const expGroupAmt = getExpenseGroupAmount(exp);
                  return (
                    <div
                      key={exp._id}
                      onClick={() => {
                        setEditingExpense(exp);
                        setShowAddExpense(true);
                      }}
                      className="p-4 rounded-3xl bg-white border border-slate-200 hover:border-slate-300 shadow-sm space-y-2 cursor-pointer transition-all"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <h4 className="font-bold text-slate-900 text-sm truncate">{exp.title}</h4>
                          <p className="text-[10px] text-slate-400 font-medium">
                            Paid by {paidByMember}
                          </p>
                          {exp.category && (
                            <span className="inline-block mt-1 px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 text-[10px] font-semibold">
                              {exp.category}
                            </span>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-mono font-bold text-slate-900 text-sm">
                            {formatCurrency(exp.amount, exp.currency)}
                          </div>
                          {!isSameCurrency && (
                            <div className="font-mono text-[10px] text-slate-400">
                              ≈ {fmtGroup(expGroupAmt)}
                            </div>
                          )}
                        </div>
                      </div>
                      <p className="text-[10px] text-slate-400 font-mono">
                        {new Date(exp.timestamp).toLocaleDateString()}
                      </p>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}

        {activeTab === 'balances' && (
          <div className="space-y-3">
            {simplifiedDebts.length > 0 && (
              <div className="p-4 rounded-3xl bg-emerald-50/60 border border-emerald-100 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                    Suggested Settlements
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowDebtTransfersBreakdown((v) => !v)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-white border border-emerald-200 text-emerald-800 text-[11px] font-bold hover:bg-emerald-50 cursor-pointer transition-colors"
                  >
                    <span>
                      {showDebtTransfersBreakdown ? 'Hide Math Trace' : 'Who Owes Who & Transfers'}
                    </span>
                    {showDebtTransfersBreakdown ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>

                <div className="space-y-2">
                  {simplifiedDebts.map((debt, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between bg-white p-3 rounded-2xl border border-emerald-200/60 shadow-sm text-xs font-medium gap-2"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-bold text-slate-900 truncate">{debt.fromName}</span>
                        <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="font-bold text-slate-900 truncate">{debt.toName}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono font-bold text-emerald-700">
                          {fmtGroup(debt.amountALL)}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            handleQuickSettle(debt.fromMemberId, debt.toMemberId, debt.amountALL)
                          }
                          className="px-2.5 py-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] cursor-pointer"
                        >
                          Pay
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Group Members & Claim Status Directory */}
            <div className="p-4 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 gap-2">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Group Members ({members.length})
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {claimedMembers.length} claimed · {unclaimedMembers.length} unclaimed
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddMember(true)}
                  className="px-2.5 py-1 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-colors shrink-0"
                >
                  <UserPlus className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Add</span>
                </button>
              </div>

              <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-100 text-[11px] font-bold">
                <button
                  type="button"
                  onClick={() => setMemberFilter('all')}
                  className={`py-1.5 rounded-lg transition-all cursor-pointer ${
                    memberFilter === 'all'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  All ({members.length})
                </button>
                <button
                  type="button"
                  onClick={() => setMemberFilter('claimed')}
                  className={`py-1.5 rounded-lg transition-all cursor-pointer ${
                    memberFilter === 'claimed'
                      ? 'bg-white text-emerald-700 shadow-xs'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Claimed ({claimedMembers.length})
                </button>
                <button
                  type="button"
                  onClick={() => setMemberFilter('unclaimed')}
                  className={`py-1.5 rounded-lg transition-all cursor-pointer ${
                    memberFilter === 'unclaimed'
                      ? 'bg-white text-amber-700 shadow-xs'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Unclaimed ({unclaimedMembers.length})
                </button>
              </div>

              <div className="space-y-2">
                {filteredMembers.length === 0 ? (
                  <p className="text-xs text-slate-400 italic py-2 text-center">
                    No members match this filter.
                  </p>
                ) : (
                  filteredMembers.map((m: any) => {
                    const net = balancesInGroup.get(m._id) ?? 0;
                    const display = formatCurrency(net, group.currency, true);
                    const linkedUserId = getLinkedUserId(m);
                    const isClaimed = Boolean(linkedUserId);
                    const isCurrentUser = clerkUserId != null && linkedUserId === clerkUserId;
                    const isGroupCreator =
                      linkedUserId != null && linkedUserId === (group as any).createdBy;

                    return (
                      <div
                        key={m._id}
                        className="p-2.5 rounded-2xl bg-slate-50/80 border border-slate-100 flex items-center justify-between gap-2"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div
                            className={`w-8 h-8 rounded-xl font-bold flex items-center justify-center text-xs shrink-0 ${
                              isClaimed
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-amber-100/80 text-amber-800'
                            }`}
                          >
                            {m.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-slate-900 text-xs truncate">
                                {m.name}
                              </span>
                              {isCurrentUser && (
                                <span className="px-1.5 py-0.5 rounded-md bg-slate-900 text-white text-[9px] font-bold uppercase">
                                  You
                                </span>
                              )}
                              {isGroupCreator && (
                                <span className="px-1.5 py-0.5 rounded-md bg-indigo-100 text-indigo-700 text-[9px] font-bold flex items-center gap-0.5">
                                  <Crown className="w-2.5 h-2.5" />
                                  Owner
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5 mt-0.5">
                              {isClaimed ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700">
                                  <UserCheck className="w-3 h-3" />
                                  Claimed account
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700">
                                  <UserX className="w-3 h-3" />
                                  Unclaimed slot
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {!isClaimed && clerkUserId && !currentUserAlreadyClaimedInGroup && (
                            <button
                              type="button"
                              disabled={claimingMemberId === m._id}
                              onClick={() => handleClaimMember(m._id)}
                              className="px-2 py-1 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-900 text-[10px] font-bold cursor-pointer transition-colors disabled:opacity-50"
                            >
                              {claimingMemberId === m._id ? 'Claiming…' : 'Claim'}
                            </button>
                          )}

                          <span
                            className={`font-mono font-bold text-xs ${
                              net > 0
                                ? 'text-emerald-600'
                                : net < 0
                                  ? 'text-rose-600'
                                  : 'text-slate-400'
                            }`}
                          >
                            {net === 0 ? 'Settled' : display}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {showDebtTransfersBreakdown && (
              <div className="p-4 rounded-3xl bg-white border border-slate-200 shadow-sm space-y-4 animate-in fade-in">
                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    1. Direct Pairwise Balances (Before Simplifying)
                  </h4>
                  {directPairwiseDebts.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">No direct pairwise balances.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {directPairwiseDebts.map((pair, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between px-3 py-2 rounded-2xl bg-slate-50 border border-slate-100 text-xs gap-2"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="font-bold text-rose-700 truncate">{pair.fromName}</span>
                            <span className="text-slate-400">owes</span>
                            <span className="font-bold text-emerald-700 truncate">
                              {pair.toName}
                            </span>
                          </div>
                          <span className="font-mono font-bold text-slate-800 shrink-0">
                            {fmtGroup(pair.amount)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2 pt-3 border-t border-slate-100">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    2. Debt Transfer / Offset Steps
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Offsets shift obligations between debtors and creditors so net totals stay unchanged with fewer payments.
                  </p>
                  {debtTransferSteps.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">Everything is already net-zero.</p>
                  ) : (
                    <div className="space-y-2">
                      {debtTransferSteps.map((step, idx) => (
                        <div
                          key={idx}
                          className="p-2.5 rounded-2xl bg-indigo-50/50 border border-indigo-100 text-xs space-y-1"
                        >
                          <div className="flex items-center justify-between font-bold text-slate-900">
                            <span>
                              Step {idx + 1}: {step.debtorName} → {step.creditorName}
                            </span>
                            <span className="font-mono text-indigo-700">
                              {fmtGroup(step.amount)}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-500 font-mono">
                            Remaining owed by {step.debtorName}:{' '}
                            {fmtGroup(step.debtorRemainingAfter)} · Remaining owed to{' '}
                            {step.creditorName}: {fmtGroup(step.creditorRemainingAfter)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2 pt-3 border-t border-slate-100">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    3. Per-Member Math Reconciliation
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Adding each member&apos;s entries below equals their exact net balance (+ = owed to them, - = they owe).
                  </p>
                  <div className="space-y-2">
                    {memberMathLedgers.map((ledger) => (
                      <div
                        key={ledger.memberId}
                        className="p-3 rounded-2xl bg-slate-50 border border-slate-100 space-y-1.5 text-xs"
                      >
                        <div className="flex items-center justify-between font-bold">
                          <span className="text-slate-900">{ledger.name}</span>
                          <span
                            className={`font-mono ${
                              ledger.netBalance > 0
                                ? 'text-emerald-600'
                                : ledger.netBalance < 0
                                  ? 'text-rose-600'
                                  : 'text-slate-500'
                            }`}
                          >
                            Net: {formatCurrency(ledger.netBalance, group.currency, true)}
                          </span>
                        </div>
                        {ledger.items.length === 0 ? (
                          <p className="text-[11px] text-slate-400 italic">No balance entries</p>
                        ) : (
                          <div className="space-y-1 pt-1 border-t border-slate-200/60">
                            {ledger.items.map((item) => (
                              <div
                                key={item.id}
                                className="flex items-center justify-between text-[11px] gap-2"
                              >
                                <span className="text-slate-600 truncate">{item.label}</span>
                                <span
                                  className={`font-mono font-semibold shrink-0 ${
                                    item.delta >= 0 ? 'text-emerald-700' : 'text-rose-700'
                                  }`}
                                >
                                  {formatCurrency(item.delta, group.currency, true)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      <AddExpenseModal
        isOpen={showAddExpense}
        onClose={() => {
          setShowAddExpense(false);
          setEditingExpense(null);
        }}
        groupId={groupId}
        groupCurrency={group.currency}
        allowedCurrencies={allowedCurrencies}
        members={members}
        initialExpense={editingExpense}
      />
      <AddMemberModal
        isOpen={showAddMember}
        onClose={() => setShowAddMember(false)}
        groupId={groupId}
        members={members}
        groupOwnerId={(group as any).createdBy}
      />
      <SettleDebtModal
        isOpen={showSettle}
        onClose={() => {
          setShowSettle(false);
          setEditingSettlement(null);
        }}
        groupId={groupId}
        groupCurrency={group.currency}
        allowedCurrencies={allowedCurrencies}
        members={members}
        initialFromMemberId={settleFrom}
        initialToMemberId={settleTo}
        initialAmount={settleAmount}
        initialSettlement={editingSettlement}
      />
      <GroupSettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        groupId={groupId}
        currentName={group.name}
        currentCurrency={group.currency}
        currentAllowedCurrencies={allowedCurrencies}
        isOwner={isOwner}
        isArchived={isArchived}
        onDeleted={onBack}
      />
    </div>
  );
};