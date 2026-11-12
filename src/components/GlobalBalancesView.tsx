import React, { useState, useEffect } from 'react';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import {
  Scale,
  Users,
  ChevronRight,
  ArrowUpRight,
  ArrowDownLeft,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { formatCurrency, convertFromALL, fetchExchangeRate } from '../utils/currencies';

interface GlobalBalancesViewProps {
  onSelectGroup: (groupId: string) => void;
}

export const GlobalBalancesView: React.FC<GlobalBalancesViewProps> = ({ onSelectGroup }) => {
  const groups = useQuery((api as any).groups?.getMyGroups || (api as any).groups?.listGroups);
  const isLoading = groups === undefined;

  const prefs = useQuery((api as any).preferences?.getMyPreferences, {}) as
    | { baseCurrency: string }
    | undefined;
  const baseCurrency: string = prefs?.baseCurrency ?? 'ALL';

  const [liveRate, setLiveRate] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (baseCurrency === 'ALL') {
      setLiveRate(1);
      return;
    }
    fetchExchangeRate(baseCurrency, 'ALL')
      .then((r) => {
        if (!cancelled) setLiveRate(typeof r === 'number' && r > 0 ? r : null);
      })
      .catch(() => {
        if (!cancelled) setLiveRate(null);
      });
    return () => {
      cancelled = true;
    };
  }, [baseCurrency]);

  const fmtBase = (amountALL: number, showSign = false): string => {
    const rate = liveRate ?? 1;
    const inBase =
      baseCurrency === 'ALL'
        ? Math.round(amountALL)
        : Number((amountALL / rate).toFixed(2));
    return formatCurrency(inBase, baseCurrency, showSign);
  };

  let totalReceivableALL = 0;
  let totalPayableALL = 0;

  const groupSummaries = (Array.isArray(groups) ? groups : []).map((group: any) => {
    const groupCurrency = group.currency || 'ALL';
    const netBalanceALL = group.myNetBalanceALL ?? group.netBalanceALL ?? group.netBalance ?? 0;
    const netBalanceGroup =
      typeof group.myNetBalanceGroup === 'number'
        ? group.myNetBalanceGroup
        : groupCurrency === 'ALL'
          ? netBalanceALL
          : convertFromALL(netBalanceALL, groupCurrency);

    if (netBalanceALL > 0) {
      totalReceivableALL += netBalanceALL;
    } else if (netBalanceALL < 0) {
      totalPayableALL += Math.abs(netBalanceALL);
    }

    const memberCount =
      group.memberCount ??
      group.membersCount ??
      group.members?.length ??
      group.memberIds?.length ??
      1;

    return {
      id: group._id,
      name: group.name,
      currency: groupCurrency,
      memberCount,
      netBalanceGroup,
    };
  });

  const netPosition = totalReceivableALL - totalPayableALL;

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-3 font-sans">
        <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
        <p className="text-xs text-slate-400 font-medium">Calculating cross-group balances…</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md mx-auto space-y-4 font-sans animate-in fade-in">
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xl shadow-slate-200/50 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
              <Scale className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Global Net Position</h3>
              <p className="text-[10px] text-slate-400">
                Across {groupSummaries.length} active group{groupSummaries.length === 1 ? '' : 's'} ({baseCurrency})
              </p>
            </div>
          </div>
          <div className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 font-mono text-xs font-bold flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-emerald-500" />
            <span>Combined</span>
          </div>
        </div>

        <div className="pt-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
            Net Settlement Balance
          </p>
          <div className="flex items-baseline gap-2">
            <span
              className={`text-3xl font-mono font-extrabold tracking-tight ${
                netPosition > 0
                  ? 'text-emerald-600'
                  : netPosition < 0
                  ? 'text-rose-600'
                  : 'text-slate-900'
              }`}
            >
              {netPosition > 0 ? '+' : ''}
              {fmtBase(netPosition)}
            </span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">
            {netPosition > 0
              ? 'You are owed more overall than you owe across your trip groups.'
              : netPosition < 0
              ? 'You have outstanding debts across your active trip groups.'
              : 'You are completely settled up in all active groups!'}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-100">
          <div className="p-3 rounded-2xl bg-emerald-50/60 border border-emerald-100">
            <div className="flex items-center gap-1.5 text-emerald-700 text-[10px] font-bold uppercase tracking-wider mb-1">
              <ArrowDownLeft className="w-3.5 h-3.5" />
              <span>Owed To You</span>
            </div>
            <p className="text-base font-mono font-bold text-emerald-700">
              {fmtBase(totalReceivableALL)}
            </p>
          </div>

          <div className="p-3 rounded-2xl bg-rose-50/60 border border-rose-100">
            <div className="flex items-center gap-1.5 text-rose-700 text-[10px] font-bold uppercase tracking-wider mb-1">
              <ArrowUpRight className="w-3.5 h-3.5" />
              <span>You Owe</span>
            </div>
            <p className="text-base font-mono font-bold text-rose-700">
              {fmtBase(totalPayableALL)}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">
          Group Breakdown
        </h4>

        {groupSummaries.length === 0 ? (
          <div className="p-8 text-center bg-white rounded-3xl border border-slate-200 shadow-sm space-y-2">
            <Users className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="text-xs font-bold text-slate-600">No Groups Found</p>
            <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
              Join or create a group to start tracking shared expenses and trip balances.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {groupSummaries.map((g: any) => (
              <button
                key={g.id}
                onClick={() => onSelectGroup(g.id)}
                className="w-full p-4 rounded-2xl bg-white border border-slate-200 shadow-sm hover:border-slate-300 transition-all text-left flex items-center justify-between group cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 font-bold text-sm ${
                      g.netBalanceGroup > 0
                        ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                        : g.netBalanceGroup < 0
                        ? 'bg-rose-50 text-rose-600 border border-rose-200'
                        : 'bg-slate-100 text-slate-600 border border-slate-200'
                    }`}
                  >
                    {g.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-900 truncate">{g.name}</p>
                    <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                      <Users className="w-3 h-3" />
                      <span>{g.memberCount} member{g.memberCount === 1 ? '' : 's'}</span>
                      <span>·</span>
                      <span className="font-semibold">{g.currency}</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right">
                    <p
                      className={`text-sm font-mono font-bold ${
                        g.netBalanceGroup > 0
                          ? 'text-emerald-600'
                          : g.netBalanceGroup < 0
                          ? 'text-rose-600'
                          : 'text-slate-400'
                      }`}
                    >
                      {g.netBalanceGroup > 0 ? '+' : ''}
                      {formatCurrency(g.netBalanceGroup, g.currency)}
                    </p>
                    <p className="text-[10px] text-slate-400 font-medium">
                      {g.netBalanceGroup > 0
                        ? 'you get back'
                        : g.netBalanceGroup < 0
                        ? 'you owe'
                        : 'settled'}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-600 transition-colors" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};