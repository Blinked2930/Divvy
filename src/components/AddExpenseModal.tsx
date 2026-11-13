// src/components/AddExpenseModal.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import { X, Receipt, Check, Calculator, PieChart, Users, AlertCircle, ChevronDown, RefreshCw, Trash2 } from 'lucide-react';
import { fetchExchangeRate, formatCurrency } from '../utils/currencies';
import { allocateByShares, reconstructSharesFromAmounts } from '../utils/splitMath';
import { ConfirmDialog } from './ConfirmDialog';

interface Member {
  _id: Id<'groupMembers'>;
  name: string;
}

interface AddExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  groupId: Id<'groups'>;
  groupCurrency: string;
  allowedCurrencies?: string[];
  members: Member[];
  initialExpense?: any;
}

type SplitMode = 'equal' | 'exact' | 'shares';

export const DIVVY_CATEGORIES = [
  'Groceries',
  'Eating Out',
  'Housing & Bills',
  'Transport',
  'Shopping',
  'Personal',
  'Health & Wellness',
  'Social & Fun',
  'Travel',
  'Other',
] as const;

function normalizeDivvyCategory(raw?: string): string {
  if (!raw) return 'Other';
  const trimmed = raw.trim();
  const exact = DIVVY_CATEGORIES.find((c) => c.toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact;
  const s = trimmed.toLowerCase();
  if (s.includes('grocer')) return 'Groceries';
  if (s.includes('food') || s.includes('dining') || s.includes('eating')) return 'Eating Out';
  if (s.includes('housing') || s.includes('bill') || s.includes('utilit')) return 'Housing & Bills';
  if (s.includes('transport')) return 'Transport';
  if (s.includes('shop')) return 'Shopping';
  if (s.includes('personal')) return 'Personal';
  if (s.includes('health') || s.includes('wellness') || s.includes('gym')) return 'Health & Wellness';
  if (s.includes('social') || s.includes('fun') || s.includes('entertain')) return 'Social & Fun';
  if (s.includes('travel') || s.includes('accommod') || s.includes('hotel')) return 'Travel';
  return 'Other';
}

export const AddExpenseModal: React.FC<AddExpenseModalProps> = ({
  isOpen,
  onClose,
  groupId,
  groupCurrency,
  allowedCurrencies = ['EUR', 'USD', 'ALL'],
  members,
  initialExpense,
}) => {
  const addExpenseMutation = useMutation((api as any).groups?.addExpense || (api as any).groups?.addGroupExpense);
  const updateExpenseMutation = useMutation((api as any).groups?.updateExpense);
  const deleteExpenseMutation = useMutation((api as any).groups?.deleteExpense);

  const [title, setTitle] = useState(initialExpense?.title || initialExpense?.description || '');
  const [amount, setAmount] = useState(initialExpense ? String(initialExpense.amount) : '');
  const [selectedCurrency, setSelectedCurrency] = useState<string>(initialExpense?.currency || groupCurrency);
  const [fxRateToGroup, setFxRateToGroup] = useState<string>('1');
  const [groupToALLRate, setGroupToALLRate] = useState<number>(groupCurrency === 'ALL' ? 1 : 100);
  const [category, setCategory] = useState(normalizeDivvyCategory(initialExpense?.category));
  const [paidByMemberId, setPaidByMemberId] = useState<string>(initialExpense?.paidByMemberId || members[0]?._id || '');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>(members.map((m) => m._id));
  const [splitMode, setSplitMode] = useState<SplitMode>(initialExpense?.splitType || 'equal');

  const [exactAmounts, setExactAmounts] = useState<Record<string, string>>({});
  const [sharesMap, setSharesMap] = useState<Record<string, number>>({});
  const [showCategoryPopover, setShowCategoryPopover] = useState(false);
  const [showPaidByPopover, setShowPaidByPopover] = useState(false);
  const [showCurrencyPopover, setShowCurrencyPopover] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const currencyChoices = useMemo(() => {
    const set = new Set<string>([groupCurrency, ...allowedCurrencies]);
    if (selectedCurrency) set.add(selectedCurrency);
    return Array.from(set);
  }, [groupCurrency, allowedCurrencies, selectedCurrency]);

  useEffect(() => {
    if (!isOpen) return;

    const initialShares: Record<string, number> = {};
    const initialExacts: Record<string, string> = {};
    members.forEach((m) => {
      initialShares[m._id] = 1;
      initialExacts[m._id] = '';
    });

    if (initialExpense) {
      const expCurrency = initialExpense.currency || groupCurrency;
      const savedGroupTotal =
        initialExpense.amountInGroupCurrency ??
        (expCurrency === groupCurrency ? initialExpense.amount : undefined);
      const inferredGroupRate =
        initialExpense.fxRateToGroup ??
        (expCurrency === groupCurrency
          ? 1
          : initialExpense.amount > 0 && savedGroupTotal
            ? Math.round((savedGroupTotal / initialExpense.amount) * 10000) / 10000
            : undefined);

      setTitle(initialExpense.title || initialExpense.description || '');
      setAmount(String(initialExpense.amount));
      setSelectedCurrency(expCurrency);
      if (inferredGroupRate) setFxRateToGroup(String(inferredGroupRate));
      setCategory(normalizeDivvyCategory(initialExpense.category));
      setPaidByMemberId(initialExpense.paidByMemberId || members[0]?._id || '');
      setSplitMode(initialExpense.splitType || 'equal');

      const existingSplits: Array<{ memberId: string; amountGroup?: number; amountALL: number }> =
        initialExpense.splits ?? [];
      const activeIds = existingSplits.filter((s) => (s.amountGroup ?? s.amountALL) > 0).map((s) => s.memberId);
      setSelectedMemberIds(activeIds.length > 0 ? activeIds : members.map((m) => m._id));

      if (initialExpense.splitType === 'shares') {
        const reconstructed = reconstructSharesFromAmounts(
          existingSplits.map((s) => ({
            memberId: s.memberId,
            amountALL: s.amountGroup ?? s.amountALL,
          }))
        );
        members.forEach((m) => {
          initialShares[m._id] = reconstructed[m._id] ?? 0;
        });
      } else if (initialExpense.splitType === 'exact' && inferredGroupRate && inferredGroupRate > 0) {
        existingSplits.forEach((s) => {
          const groupAmt = s.amountGroup ?? 0;
          const inNative = Math.round((groupAmt / inferredGroupRate) * 100) / 100;
          initialExacts[s.memberId] = inNative > 0 ? String(inNative) : '';
        });
      }
    } else {
      setTitle('');
      setAmount('');
      setSelectedCurrency(groupCurrency);
      setFxRateToGroup('1');
      setCategory('Other');
      setPaidByMemberId(members[0]?._id || '');
      setSelectedMemberIds(members.map((m) => m._id));
      setSplitMode('equal');
    }

    setSharesMap(initialShares);
    setExactAmounts(initialExacts);
    setErrorMsg(null);
  }, [isOpen, groupCurrency, initialExpense, members]);

  // Fetch rate from selectedCurrency -> groupCurrency (ONLY when they differ)
  useEffect(() => {
    if (!isOpen) return;
    if (selectedCurrency === groupCurrency) {
      setFxRateToGroup('1');
      return;
    }
    if (
      initialExpense &&
      initialExpense.currency === selectedCurrency &&
      initialExpense.fxRateToGroup
    ) {
      return;
    }
    fetchExchangeRate(selectedCurrency, groupCurrency).then((rate: number) => {
      setFxRateToGroup(String(Math.round(rate * 10000) / 10000));
    });
  }, [isOpen, selectedCurrency, groupCurrency, initialExpense]);

  // Silently fetch groupCurrency -> ALL in the background for Pulse cross-app sync
  useEffect(() => {
    if (!isOpen) return;
    if (groupCurrency === 'ALL') {
      setGroupToALLRate(1);
      return;
    }
    fetchExchangeRate(groupCurrency, 'ALL').then((rate: number) => {
      setGroupToALLRate(rate);
    });
  }, [isOpen, groupCurrency]);

  const numAmount = parseFloat(amount) || 0;
  const numRateToGroup = selectedCurrency === groupCurrency ? 1 : (parseFloat(fxRateToGroup) || 0);
  const amountInGroupCurrency = Math.round(numAmount * numRateToGroup * 100) / 100;
  const amountInALL =
    groupCurrency === 'ALL'
      ? amountInGroupCurrency
      : Math.round(amountInGroupCurrency * groupToALLRate * 100) / 100;

  const totalShares = selectedMemberIds.reduce((sum, id) => {
    return sum + (sharesMap[id] ?? 1);
  }, 0);

  const sharesAllocationGroup = useMemo(() => {
    if (splitMode !== 'shares' || selectedMemberIds.length === 0) return {};
    const weights: Record<string, number> = {};
    for (const mId of selectedMemberIds) weights[mId] = sharesMap[mId] ?? 1;
    return allocateByShares(amountInGroupCurrency, weights);
  }, [splitMode, selectedMemberIds, sharesMap, amountInGroupCurrency]);

  if (!isOpen) return null;

  const toggleMember = (id: string) => {
    if (selectedMemberIds.includes(id)) {
      if (selectedMemberIds.length > 1) {
        setSelectedMemberIds(selectedMemberIds.filter((mId) => mId !== id));
      }
    } else {
      setSelectedMemberIds([...selectedMemberIds, id]);
    }
  };

  const totalExactNative = members.reduce((sum, m) => {
    return sum + (parseFloat(exactAmounts[m._id] || '0') || 0);
  }, 0);

  const exactDifferenceNative = Math.round((numAmount - totalExactNative) * 100) / 100;

  const handleDeleteConfirmed = async () => {
    const expId = initialExpense?._id || initialExpense?.id;
    if (!expId) return;
    setIsDeleting(true);
    try {
      await deleteExpenseMutation({ expenseId: expId as Id<'groupExpenses'> });
      setShowDeleteConfirm(false);
      onClose();
    } catch (err) {
      console.error('Failed to delete expense:', err);
      setErrorMsg('Failed to delete expense. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!title.trim() || numAmount <= 0) {
      setErrorMsg('Please enter a description and amount greater than 0.');
      return;
    }

    if (numRateToGroup <= 0 || amountInGroupCurrency <= 0) {
      setErrorMsg(`Please enter a valid exchange rate from ${selectedCurrency} to ${groupCurrency}.`);
      return;
    }

    let groupSplits: Array<{ memberId: Id<'groupMembers'>; amountGroup: number }> = [];

    if (splitMode === 'equal') {
      const weights: Record<string, number> = {};
      for (const mId of selectedMemberIds) weights[mId] = 1;
      const allocation = allocateByShares(amountInGroupCurrency, weights);
      groupSplits = selectedMemberIds.map((mId) => ({
        memberId: mId as Id<'groupMembers'>,
        amountGroup: allocation[mId] ?? 0,
      }));
    } else if (splitMode === 'exact') {
      if (Math.abs(exactDifferenceNative) > 0.01) {
        setErrorMsg(
          `Exact splits must sum to ${numAmount} ${selectedCurrency}. Remaining: ${exactDifferenceNative} ${selectedCurrency}`
        );
        return;
      }

      const activeExact = members
        .map((m) => ({
          memberId: m._id,
          nativeValue: Math.round((parseFloat(exactAmounts[m._id] || '0') || 0) * 100) / 100,
        }))
        .filter((x) => x.nativeValue > 0);

      if (activeExact.length === 0) {
        setErrorMsg('Please enter an amount for at least one member.');
        return;
      }

      const converted = activeExact.map((x) => ({
        memberId: x.memberId,
        amountGroup: Math.round(x.nativeValue * numRateToGroup * 100) / 100,
      }));

      const sumConverted = converted.reduce((s, x) => s + x.amountGroup, 0);
      const drift = Math.round((amountInGroupCurrency - sumConverted) * 100) / 100;
      if (Math.abs(drift) >= 0.01) {
        let largestIdx = 0;
        for (let i = 1; i < converted.length; i++) {
          if (converted[i].amountGroup > converted[largestIdx].amountGroup) largestIdx = i;
        }
        converted[largestIdx].amountGroup = Math.round((converted[largestIdx].amountGroup + drift) * 100) / 100;
      }

      groupSplits = converted;
    } else if (splitMode === 'shares') {
      if (totalShares <= 0) {
        setErrorMsg('Total shares must be at least 1.');
        return;
      }
      groupSplits = selectedMemberIds
        .filter((mId) => (sharesMap[mId] ?? 1) > 0)
        .map((mId) => ({
          memberId: mId as Id<'groupMembers'>,
          amountGroup: sharesAllocationGroup[mId] ?? 0,
        }));
    }

    // Derive proportional ALL splits silently so Pulse cross-app sync remains 100% balanced
    const weightsForALL: Record<string, number> = {};
    for (const s of groupSplits) weightsForALL[s.memberId] = Math.round(s.amountGroup * 100);
    const allocALL = allocateByShares(amountInALL, weightsForALL);

    const splits = groupSplits.map((s) => ({
      memberId: s.memberId,
      amountGroup: s.amountGroup,
      amountALL: allocALL[s.memberId] ?? 0,
    }));

    setIsSubmitting(true);
    try {
      const fxRateToALL = numAmount > 0 ? Math.round((amountInALL / numAmount) * 1000000) / 1000000 : 1;

      if (initialExpense?._id || initialExpense?.id) {
        await updateExpenseMutation({
          expenseId: (initialExpense._id || initialExpense.id) as Id<'groupExpenses'>,
          title: title.trim(),
          amount: numAmount,
          currency: selectedCurrency,
          amountInGroupCurrency,
          amountInALL,
          fxRateToGroup: numRateToGroup,
          fxRateToALL,
          category: category.trim() || 'Other',
          paidByMemberId: paidByMemberId as Id<'groupMembers'>,
          splitType: splitMode,
          splits,
        });
      } else {
        await addExpenseMutation({
          groupId,
          title: title.trim(),
          amount: numAmount,
          currency: selectedCurrency,
          amountInGroupCurrency,
          amountInALL,
          fxRateToGroup: numRateToGroup,
          fxRateToALL,
          category: category.trim() || 'Other',
          paidByMemberId: paidByMemberId as Id<'groupMembers'>,
          splitType: splitMode,
          splits,
        });
      }

      setTitle('');
      setAmount('');
      setErrorMsg(null);
      onClose();
    } catch (err: any) {
      console.error('Failed to save expense:', err);
      const serverMsg = err?.message?.replace(/^Uncaught Error:\s*/, '');
      setErrorMsg(serverMsg || 'Failed to save expense. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const paidByName = members.find((m) => m._id === paidByMemberId)?.name || 'Select member';

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in"
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-2xl p-6 space-y-4 font-sans max-h-[85vh] overflow-y-auto"
        >
          <div className="flex items-center justify-between pb-2 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
                <Receipt className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">
                {initialExpense ? 'Edit Group Expense' : 'Add Group Expense'}
              </h3>
            </div>
            <div className="flex items-center gap-1">
              {initialExpense && (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={isDeleting}
                  className="p-1.5 rounded-full text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                  title="Delete expense"
                >
                  <Trash2 className="w-5 h-5 text-rose-500" />
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                Description *
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Dinner, Taxi, Groceries"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-4 py-3 rounded-2xl bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 text-sm font-medium"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                  Amount *
                </label>
                <input
                  type="number"
                  step="any"
                  required
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full px-4 py-3 rounded-2xl bg-slate-50 border border-slate-200 text-slate-900 font-mono text-sm font-bold focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                  Currency
                </label>
                <button
                  type="button"
                  onClick={() => setShowCurrencyPopover(true)}
                  className="w-full px-3 py-3 rounded-2xl bg-slate-50 border border-slate-200 text-slate-900 text-xs font-bold flex items-center justify-between cursor-pointer hover:border-slate-300 transition-colors"
                >
                  <span>{selectedCurrency}</span>
                  <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                </button>
              </div>
            </div>

            {/* Only shown when expense currency differs from the group's currency (e.g. USD in a EUR group) */}
            {selectedCurrency !== groupCurrency && (
              <div className="p-3 rounded-2xl bg-amber-50/70 border border-amber-200/80 space-y-2 text-xs">
                <div className="flex items-center justify-between font-bold text-amber-900">
                  <span className="flex items-center gap-1">
                    <RefreshCw className="w-3.5 h-3.5 text-amber-600" />
                    Group Currency Equivalent ({groupCurrency})
                  </span>
                  <span className="font-mono">{formatCurrency(amountInGroupCurrency, groupCurrency)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-amber-700 text-[10px]">1 {selectedCurrency} =</span>
                  <input
                    type="number"
                    step="any"
                    value={fxRateToGroup}
                    onChange={(e) => setFxRateToGroup(e.target.value)}
                    className="w-24 px-2 py-1 rounded-xl bg-white border border-amber-300 font-mono text-xs text-amber-900 focus:outline-none focus:border-amber-500"
                  />
                  <span className="text-amber-700 text-[10px]">{groupCurrency}</span>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                  Category
                </label>
                <button
                  type="button"
                  onClick={() => setShowCategoryPopover(true)}
                  className="w-full px-3 py-3 rounded-2xl bg-slate-50 border border-slate-200 text-slate-900 text-xs font-semibold flex items-center justify-between cursor-pointer hover:border-slate-300 transition-colors"
                >
                  <span className="truncate">{category}</span>
                  <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                </button>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                  Paid By *
                </label>
                <button
                  type="button"
                  onClick={() => setShowPaidByPopover(true)}
                  className="w-full px-3 py-3 rounded-2xl bg-slate-50 border border-slate-200 text-slate-900 text-xs font-semibold flex items-center justify-between cursor-pointer hover:border-slate-300 transition-colors"
                >
                  <span className="truncate">{paidByName}</span>
                  <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                </button>
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-slate-100">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
                Split Option
              </label>
              <div className="grid grid-cols-3 gap-1 bg-slate-100 p-1 rounded-2xl">
                <button
                  type="button"
                  onClick={() => setSplitMode('equal')}
                  className={`py-2 text-xs font-bold rounded-xl flex items-center justify-center gap-1 transition-all cursor-pointer ${
                    splitMode === 'equal' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Users className="w-3.5 h-3.5" />
                  Equal
                </button>
                <button
                  type="button"
                  onClick={() => setSplitMode('exact')}
                  className={`py-2 text-xs font-bold rounded-xl flex items-center justify-center gap-1 transition-all cursor-pointer ${
                    splitMode === 'exact' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Calculator className="w-3.5 h-3.5" />
                  Exact
                </button>
                <button
                  type="button"
                  onClick={() => setSplitMode('shares')}
                  className={`py-2 text-xs font-bold rounded-xl flex items-center justify-center gap-1 transition-all cursor-pointer ${
                    splitMode === 'shares' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <PieChart className="w-3.5 h-3.5" />
                  Shares
                </button>
              </div>
            </div>

            {splitMode === 'equal' && (
              <div className="grid grid-cols-2 gap-2">
                {members.map((m) => {
                  const isSelected = selectedMemberIds.includes(m._id);
                  return (
                    <button
                      key={m._id}
                      type="button"
                      onClick={() => toggleMember(m._id)}
                      className={`py-2.5 px-3 rounded-xl border text-xs font-semibold flex items-center justify-between transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                          : 'bg-slate-50 border-slate-200 text-slate-400'
                      }`}
                    >
                      <span>{m.name}</span>
                      {isSelected && <Check className="w-3.5 h-3.5 text-emerald-600" />}
                    </button>
                  );
                })}
              </div>
            )}

            {splitMode === 'exact' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs px-1 font-medium">
                  <span className="text-slate-500">Allocated: {totalExactNative} {selectedCurrency}</span>
                  <span className={Math.abs(exactDifferenceNative) <= 0.01 ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>
                    {exactDifferenceNative === 0 ? 'Balanced' : `${exactDifferenceNative} ${selectedCurrency} remaining`}
                  </span>
                </div>
                <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                  {members.map((m) => (
                    <div key={m._id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-slate-700 w-1/3 truncate">{m.name}</span>
                      <input
                        type="number"
                        step="any"
                        placeholder="0"
                        value={exactAmounts[m._id] || ''}
                        onChange={(e) =>
                          setExactAmounts({
                            ...exactAmounts,
                            [m._id]: e.target.value,
                          })
                        }
                        className="w-2/3 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 font-mono text-xs focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {splitMode === 'shares' && (
              <div className="space-y-2">
                <p className="text-[10px] text-slate-400 font-medium">
                  Set relative shares per person (e.g. 2 shares = double portion).
                </p>
                <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                  {members.map((m) => {
                    const currentShare = sharesMap[m._id] ?? 1;
                    const calculatedGroup = sharesAllocationGroup[m._id] ?? 0;
                    return (
                      <div key={m._id} className="flex items-center justify-between gap-2 text-xs">
                        <div className="w-1/2 truncate">
                          <span className="font-semibold text-slate-700 block">{m.name}</span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {formatCurrency(calculatedGroup, groupCurrency)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setSharesMap({
                                ...sharesMap,
                                [m._id]: Math.max(0, currentShare - 1),
                              })
                            }
                            className="w-7 h-7 rounded-lg bg-slate-100 text-slate-600 font-bold flex items-center justify-center hover:bg-slate-200 cursor-pointer"
                          >
                            -
                          </button>
                          <span className="font-mono font-bold w-4 text-center">{currentShare}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setSharesMap({
                                ...sharesMap,
                                [m._id]: currentShare + 1,
                              })
                            }
                            className="w-7 h-7 rounded-lg bg-slate-100 text-slate-600 font-bold flex items-center justify-center hover:bg-slate-200 cursor-pointer"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {errorMsg && (
              <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting || isDeleting || !title.trim() || numAmount <= 0}
              className="w-full py-3.5 px-4 rounded-2xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer mt-4"
            >
              <Check className="w-4 h-4" />
              <span>{isSubmitting ? 'Saving...' : initialExpense ? 'Update Expense' : 'Save Expense'}</span>
            </button>
          </form>

          {showCurrencyPopover && (
            <div
              onClick={() => setShowCurrencyPopover(false)}
              className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in"
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-xs bg-white rounded-3xl border border-slate-200 shadow-2xl p-4 space-y-2 font-sans"
              >
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider px-2 mb-2">
                  Allowed Currencies
                </h4>
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {currencyChoices.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => {
                        setSelectedCurrency(c);
                        setShowCurrencyPopover(false);
                      }}
                      className={`w-full text-left px-4 py-3 rounded-2xl text-xs font-bold transition-all cursor-pointer flex items-center justify-between ${
                        selectedCurrency === c
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <span>{c}</span>
                      {selectedCurrency === c && <Check className="w-4 h-4 text-emerald-600" />}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {showCategoryPopover && (
            <div
              onClick={() => setShowCategoryPopover(false)}
              className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in"
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-xs bg-white rounded-3xl border border-slate-200 shadow-2xl p-4 space-y-2 font-sans"
              >
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider px-2 mb-2">
                  Select Category
                </h4>
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {DIVVY_CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => {
                        setCategory(cat);
                        setShowCategoryPopover(false);
                      }}
                      className={`w-full text-left px-4 py-3 rounded-2xl text-xs font-bold transition-all cursor-pointer flex items-center justify-between ${
                        category === cat
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <span>{cat}</span>
                      {category === cat && <Check className="w-4 h-4 text-emerald-600" />}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {showPaidByPopover && (
            <div
              onClick={() => setShowPaidByPopover(false)}
              className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in"
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-xs bg-white rounded-3xl border border-slate-200 shadow-2xl p-4 space-y-2 font-sans"
              >
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider px-2 mb-2">
                  Select Member
                </h4>
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {members.map((m) => (
                    <button
                      key={m._id}
                      type="button"
                      onClick={() => {
                        setPaidByMemberId(m._id);
                        setShowPaidByPopover(false);
                      }}
                      className={`w-full text-left px-4 py-3 rounded-2xl text-xs font-bold transition-all cursor-pointer flex items-center justify-between ${
                        paidByMemberId === m._id
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-slate-50 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <span>{m.name}</span>
                      {paidByMemberId === m._id && <Check className="w-4 h-4 text-emerald-600" />}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Delete this expense?"
        message="This removes the expense from the group. Balances recalculate automatically."
        confirmLabel={isDeleting ? 'Deleting…' : 'Delete'}
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </>
  );
};