// src/components/ActivityFeedView.tsx
import React, { useMemo, useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import {
  Activity,
  Receipt,
  CheckCircle2,
  UserPlus,
  Loader2,
  Clock,
  ChevronRight,
  Pencil,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { formatCurrency } from '../utils/currencies';
import { AddExpenseModal } from './AddExpenseModal';

interface ActivityFeedViewProps {
  onSelectGroup: (groupId: string) => void;
}

interface ConfirmDeleteState {
  id: string;
  type: 'expense' | 'settlement';
  title: string;
}

function formatRelativeTime(timestamp?: number): string {
  if (!timestamp) return 'Recently';
  try {
    const diffMs = Date.now() - timestamp;
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 45) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}h ago`;
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return new Date(timestamp).toLocaleDateString('en-GB', {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return 'Recently';
  }
}

export const ActivityFeedView: React.FC<ActivityFeedViewProps> = ({ onSelectGroup }) => {
  const rawActivityData = useQuery((api as any).groups?.getActivityFeed, {});
  const isLoading = rawActivityData === undefined;
  const activityData = rawActivityData ?? [];

  const deleteExpenseMutation = useMutation((api as any).groups?.deleteExpense);
  const deleteSettlementMutation = useMutation((api as any).groups?.deleteSettlement);

  const [editingActivity, setEditingActivity] = useState<any | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ConfirmDeleteState | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Hydrate full group details (members, allowedCurrencies, full expense splits) when editing
  const editingGroupDetails = useQuery(
    (api as any).groups?.getGroupDetails,
    editingActivity?.groupId ? { groupId: editingActivity.groupId } : 'skip'
  );

  const hydratedInitialExpense = useMemo(() => {
    if (!editingActivity) return null;
    const targetId = editingActivity.id || editingActivity._id;
    const fullFromGroup = editingGroupDetails?.expenses?.find(
      (e: any) => e._id === targetId
    );
    if (fullFromGroup) return fullFromGroup;

    return {
      ...editingActivity,
      _id: targetId,
      splits: editingActivity.splits ?? [],
    };
  }, [editingActivity, editingGroupDetails]);

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    setIsDeleting(true);
    try {
      if (confirmDelete.type === 'settlement') {
        await deleteSettlementMutation({ settlementId: confirmDelete.id });
      } else {
        await deleteExpenseMutation({ expenseId: confirmDelete.id });
      }
      setConfirmDelete(null);
    } catch (err) {
      console.error('Failed to delete activity item:', err);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleEdit = (e: React.MouseEvent, act: any) => {
    e.stopPropagation();
    setEditingActivity(act);
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-3">
        <Loader2 className="w-6 h-6 text-emerald-500 animate-spin" />
        <p className="text-xs text-slate-400 font-medium">Loading group activity stream…</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md mx-auto space-y-4 font-sans">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600">
            <Activity className="w-4 h-4" />
          </div>
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Recent Activity
          </h3>
        </div>
        <span className="text-[11px] text-slate-400 font-medium">Live Feed</span>
      </div>

      {activityData.length === 0 ? (
        <div className="p-8 text-center bg-white rounded-3xl border border-slate-200 shadow-sm space-y-2">
          <Clock className="w-8 h-8 text-slate-300 mx-auto" />
          <p className="text-xs font-bold text-slate-600">No Recent Actions</p>
          <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
            Expenses, debt settlements, and member joins will appear here in chronological order.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {activityData.map((act: any) => {
            const isSettlement = act.type === 'settlement';
            const isMemberJoin = act.type === 'member_join';
            const isExpense = act.type === 'expense';
            const itemId = act.id || act._id;
            const groupCurrency = act.groupCurrency || act.currency || 'ALL';
            const showGroupConversion =
              act.currency &&
              act.groupCurrency &&
              act.currency !== act.groupCurrency &&
              typeof act.amountInGroupCurrency === 'number';
            const showMyShare =
              isExpense &&
              typeof act.myShareALL === 'number' &&
              act.myShareALL > 0;

            return (
              <div
                key={itemId || act.timestamp}
                onClick={() => act.groupId && onSelectGroup(act.groupId)}
                className="w-full p-4 rounded-2xl bg-white border border-slate-200 shadow-sm hover:border-slate-300 transition-all text-left flex items-start gap-3 group cursor-pointer"
              >
                <div
                  className={`p-2.5 rounded-2xl shrink-0 mt-0.5 ${
                    isSettlement
                      ? 'bg-indigo-50 text-indigo-600 border border-indigo-200'
                      : isMemberJoin
                      ? 'bg-amber-50 text-amber-600 border border-amber-200'
                      : 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                  }`}
                >
                  {isSettlement ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : isMemberJoin ? (
                    <UserPlus className="w-4 h-4" />
                  ) : (
                    <Receipt className="w-4 h-4" />
                  )}
                </div>

                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-slate-900 truncate">
                      {act.groupName || 'Trip Group'}
                    </span>
                    <span className="text-[10px] text-slate-400 shrink-0 font-mono">
                      {formatRelativeTime(act.timestamp)}
                    </span>
                  </div>

                  <p className="text-xs text-slate-600 font-medium leading-relaxed truncate">
                    {act.title || act.description}
                  </p>

                  {act.amount !== undefined && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      <span className="text-xs font-mono font-bold text-slate-900">
                        {formatCurrency(act.amount, act.currency || 'ALL')}
                      </span>
                      {showGroupConversion && (
                        <span className="text-[10px] font-mono text-slate-400">
                          (≈ {formatCurrency(act.amountInGroupCurrency, groupCurrency)})
                        </span>
                      )}
                      {act.actorName && !isSettlement && (
                        <span className="text-[10px] text-slate-400">by {act.actorName}</span>
                      )}
                      {act.category && (
                        <span className="text-[10px] px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 font-semibold">
                          {act.category}
                        </span>
                      )}
                      {showMyShare && (
                        <span className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 font-mono font-semibold">
                          Your share: {formatCurrency(act.myShareALL, 'ALL')}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0 self-center">
                  {isExpense && (
                    <button
                      type="button"
                      onClick={(e) => handleEdit(e, act)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors cursor-pointer"
                      title="Edit Expense"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {(isExpense || isSettlement) && itemId && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDelete({
                          id: itemId,
                          type: isSettlement ? 'settlement' : 'expense',
                          title: act.title || (isSettlement ? 'this settlement' : 'this expense'),
                        });
                      }}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                      title={isSettlement ? 'Delete Settlement' : 'Delete Expense'}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-600 transition-colors" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {confirmDelete && (
        <div
          onClick={() => !isDeleting && setConfirmDelete(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm bg-white rounded-3xl border border-slate-200 shadow-2xl p-5 space-y-4"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-2xl bg-rose-50 border border-rose-200 flex items-center justify-center shrink-0">
                <TriangleAlert className="w-5 h-5 text-rose-500" />
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="text-sm font-bold text-slate-900">
                  Delete {confirmDelete.type === 'settlement' ? 'settlement' : 'expense'}?
                </h4>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  Are you sure you want to remove{' '}
                  <span className="font-semibold text-slate-700">{confirmDelete.title}</span>? Group
                  balances will recalculate automatically.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setConfirmDelete(null)}
                className="py-2.5 rounded-2xl bg-white border border-slate-200 text-slate-600 text-xs font-semibold hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleConfirmDelete}
                className="py-2.5 rounded-2xl bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 transition-colors cursor-pointer disabled:opacity-50"
              >
                {isDeleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingActivity && hydratedInitialExpense && (
        <AddExpenseModal
          isOpen={Boolean(editingActivity)}
          onClose={() => setEditingActivity(null)}
          groupId={editingActivity.groupId}
          groupCurrency={
            editingGroupDetails?.group?.currency ||
            editingActivity.groupCurrency ||
            editingActivity.currency ||
            'ALL'
          }
          allowedCurrencies={
            editingGroupDetails?.group?.allowedCurrencies ?? ['ALL', 'EUR', 'USD']
          }
          members={editingGroupDetails?.members ?? []}
          initialExpense={hydratedInitialExpense}
        />
      )}
    </div>
  );
};