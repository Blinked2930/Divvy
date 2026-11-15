// src/components/SettleDebtModal.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import { X, Scale, Check, ChevronDown, Loader2, Banknote, Wallet, RefreshCw } from 'lucide-react';
import { fetchExchangeRate, formatCurrency } from '../utils/currencies';

interface Member {
  _id: Id<'groupMembers'>;
  name: string;
}

interface SettleDebtModalProps {
  isOpen: boolean;
  onClose: () => void;
  groupId: Id<'groups'>;
  groupCurrency: string;
  allowedCurrencies?: string[];
  members: Member[];
  initialFromMemberId?: string;
  initialToMemberId?: string;
  initialAmount?: number;
  initialAmountALL?: number;
  initialSettlement?: any | null;
}

export const SettleDebtModal: React.FC<SettleDebtModalProps> = ({
  isOpen,
  onClose,
  groupId,
  groupCurrency,
  allowedCurrencies = ['ALL', 'EUR', 'USD'],
  members,
  initialFromMemberId,
  initialToMemberId,
  initialAmount,
  initialAmountALL,
  initialSettlement,
}) => {
  const settleDebtMutation = useMutation((api as any).groups?.settleGroupDebt);
  const updateSettlementMutation = useMutation((api as any).groups?.updateSettlement);

  const isEditing = Boolean(initialSettlement?._id);

  const [fromMemberId, setFromMemberId] = useState<string>(members[0]?._id ?? '');
  const [toMemberId, setToMemberId] = useState<string>(members[1]?._id ?? members[0]?._id ?? '');
  const [settlementCurrency, setSettlementCurrency] = useState<string>(groupCurrency);
  const [fxRateToALL, setFxRateToALL] = useState<string>('1');
  const [amount, setAmount] = useState<string>('');
  const [paidWith, setPaidWith] = useState<'Cash' | 'Card'>('Cash');
  const [showFromDropdown, setShowFromDropdown] = useState(false);
  const [showToDropdown, setShowToDropdown] = useState(false);
  const [showCurrencyDropdown, setShowCurrencyDropdown] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currencyChoices = useMemo(() => {
    return Array.from(new Set(['ALL', groupCurrency, ...allowedCurrencies]));
  }, [groupCurrency, allowedCurrencies]);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setShowFromDropdown(false);
    setShowToDropdown(false);
    setShowCurrencyDropdown(false);

    if (initialSettlement) {
      const cur = initialSettlement.currency || groupCurrency;
      const nativeAmt =
        typeof initialSettlement.amount === 'number'
          ? initialSettlement.amount
          : initialSettlement.amountALL;
      const rate =
        cur === 'ALL'
          ? 1
          : initialSettlement.fxRateToALL ??
            (nativeAmt > 0
              ? Math.round((initialSettlement.amountALL / nativeAmt) * 10000) / 10000
              : 1);

      setFromMemberId(initialSettlement.fromMemberId);
      setToMemberId(initialSettlement.toMemberId);
      setSettlementCurrency(cur);
      setAmount(String(nativeAmt));
      setFxRateToALL(String(rate));
      setPaidWith(initialSettlement.paidWith || 'Card');
      return;
    }

    if (initialFromMemberId) setFromMemberId(initialFromMemberId);
    if (initialToMemberId) setToMemberId(initialToMemberId);
    setSettlementCurrency(groupCurrency);
  }, [isOpen, initialSettlement, initialFromMemberId, initialToMemberId, groupCurrency]);

  useEffect(() => {
    if (!isOpen) return;

    if (
      initialSettlement &&
      settlementCurrency === (initialSettlement.currency || groupCurrency)
    ) {
      return;
    }

    let active = true;

    const loadRateAndPrefill = async () => {
      const rate = settlementCurrency === 'ALL'
        ? 1
        : await fetchExchangeRate(settlementCurrency, 'ALL');
      if (!active) return;

      const cleanRate = Math.round(rate * 10000) / 10000;
      setFxRateToALL(String(cleanRate));

      if (!initialSettlement) {
        if (initialAmountALL && initialAmountALL > 0) {
          const prefilled = settlementCurrency === 'ALL'
            ? Math.round(initialAmountALL)
            : Math.round((initialAmountALL / cleanRate) * 100) / 100;
          setAmount(String(prefilled));
        } else if (initialAmount && initialAmount > 0 && settlementCurrency === groupCurrency) {
          setAmount(String(initialAmount));
        }
      }
    };

    loadRateAndPrefill();
    return () => {
      active = false;
    };
  }, [isOpen, settlementCurrency, groupCurrency, initialAmount, initialAmountALL, initialSettlement]);

  if (!isOpen) return null;

  const numAmount = parseFloat(amount) || 0;
  const numRateToALL = settlementCurrency === 'ALL' ? 1 : (parseFloat(fxRateToALL) || 0);
  const amountALL = Math.round(numAmount * numRateToALL * 100) / 100;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!fromMemberId || !toMemberId || fromMemberId === toMemberId) {
      setError('Please select two different members.');
      return;
    }

    if (numAmount <= 0 || amountALL <= 0) {
      setError('Please enter a valid amount and exchange rate greater than 0.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (isEditing && initialSettlement?._id) {
        await updateSettlementMutation({
          settlementId: initialSettlement._id as Id<'groupSettlements'>,
          fromMemberId: fromMemberId as Id<'groupMembers'>,
          toMemberId: toMemberId as Id<'groupMembers'>,
          amount: numAmount,
          amountALL,
          fxRateToALL: numRateToALL,
          currency: settlementCurrency,
          paidWith,
        });
      } else {
        await settleDebtMutation({
          groupId,
          fromMemberId: fromMemberId as Id<'groupMembers'>,
          toMemberId: toMemberId as Id<'groupMembers'>,
          amount: numAmount,
          amountALL,
          fxRateToALL: numRateToALL,
          currency: settlementCurrency,
          paidWith,
        });
      }

      onClose();
    } catch (err) {
      console.error('Failed to save settlement:', err);
      setError('Could not save settlement. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const fromName = members.find((m) => m._id === fromMemberId)?.name || 'Payer';
  const toName = members.find((m) => m._id === toMemberId)?.name || 'Recipient';

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-2xl p-6 space-y-4 font-sans max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
              <Scale className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">
              {isEditing ? 'Edit Settlement' : 'Settle Group Debt'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
              Payer (Who Paid) *
            </label>
            <button
              type="button"
              onClick={() => setShowFromDropdown(!showFromDropdown)}
              className="w-full px-4 py-3 rounded-2xl bg-slate-50 border border-slate-200 text-slate-900 text-sm font-semibold flex items-center justify-between cursor-pointer"
            >
              <span>{fromName}</span>
              <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
            </button>

            {showFromDropdown && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-2xl shadow-xl z-30 overflow-hidden py-1">
                {members.map((m) => (
                  <button
                    key={m._id}
                    type="button"
                    onClick={() => {
                      setFromMemberId(m._id);
                      setShowFromDropdown(false);
                    }}
                    className="w-full text-left px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 cursor-pointer"
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
              Recipient (Who Received) *
            </label>
            <button
              type="button"
              onClick={() => setShowToDropdown(!showToDropdown)}
              className="w-full px-4 py-3 rounded-2xl bg-slate-50 border border-slate-200 text-slate-900 text-sm font-semibold flex items-center justify-between cursor-pointer"
            >
              <span>{toName}</span>
              <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
            </button>

            {showToDropdown && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-2xl shadow-xl z-30 overflow-hidden py-1">
                {members.map((m) => (
                  <button
                    key={m._id}
                    type="button"
                    onClick={() => {
                      setToMemberId(m._id);
                      setShowToDropdown(false);
                    }}
                    className="w-full text-left px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 cursor-pointer"
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            )}
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

            <div className="relative">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                Currency
              </label>
              <button
                type="button"
                onClick={() => setShowCurrencyDropdown(!showCurrencyDropdown)}
                className="w-full px-3 py-3 rounded-2xl bg-slate-50 border border-slate-200 text-slate-900 text-xs font-bold flex items-center justify-between cursor-pointer"
              >
                <span>{settlementCurrency}</span>
                <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
              </button>

              {showCurrencyDropdown && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-2xl shadow-xl z-30 overflow-hidden py-1">
                  {currencyChoices.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => {
                        setSettlementCurrency(c);
                        setShowCurrencyDropdown(false);
                      }}
                      className="w-full text-left px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 cursor-pointer"
                    >
                      {c}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {settlementCurrency !== 'ALL' && (
            <div className="p-3 rounded-2xl bg-amber-50/70 border border-amber-200/80 space-y-2 text-xs">
              <div className="flex items-center justify-between font-bold text-amber-900">
                <span className="flex items-center gap-1">
                  <RefreshCw className="w-3.5 h-3.5 text-amber-600" />
                  Base Lek Settlement (ALL)
                </span>
                <span className="font-mono">{formatCurrency(amountALL, 'ALL')}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-amber-700 text-[10px]">1 {settlementCurrency} =</span>
                <input
                  type="number"
                  step="any"
                  value={fxRateToALL}
                  onChange={(e) => setFxRateToALL(e.target.value)}
                  className="w-24 px-2 py-1 rounded-xl bg-white border border-amber-300 font-mono text-xs text-amber-900 focus:outline-none focus:border-amber-500"
                />
                <span className="text-amber-700 text-[10px]">ALL</span>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">
              Payment Method (Syncs to Pulse) *
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPaidWith('Cash')}
                className={`flex items-center justify-center gap-2 py-3 rounded-2xl border text-xs font-bold transition-all cursor-pointer ${
                  paidWith === 'Cash'
                    ? 'bg-teal-50 border-teal-500 text-teal-700 shadow-xs'
                    : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
                }`}
              >
                <Banknote className="w-4 h-4" />
                <span>Physical Cash</span>
              </button>
              <button
                type="button"
                onClick={() => setPaidWith('Card')}
                className={`flex items-center justify-center gap-2 py-3 rounded-2xl border text-xs font-bold transition-all cursor-pointer ${
                  paidWith === 'Card'
                    ? 'bg-rose-50 border-rose-500 text-rose-700 shadow-xs'
                    : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
                }`}
              >
                <Wallet className="w-4 h-4" />
                <span>Bank / Card</span>
              </button>
            </div>
          </div>

          {error && <p className="text-xs text-rose-600 font-medium">{error}</p>}

          <button
            type="submit"
            disabled={isSubmitting || numAmount <= 0}
            className="w-full py-3.5 px-4 rounded-2xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer mt-4"
          >
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            <span>
              {isSubmitting
                ? 'Saving...'
                : isEditing
                  ? 'Save Changes'
                  : 'Record Payment'}
            </span>
          </button>
        </form>
      </div>
    </div>
  );
};