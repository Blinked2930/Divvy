// src/components/AddMemberModal.tsx
import React, { useState, useMemo } from 'react';
import { useMutation } from 'convex/react';
import { useUser } from '@clerk/clerk-react';
import { api } from '../../convex/_generated/api';
import { Id } from '../../convex/_generated/dataModel';
import {
  X,
  UserPlus,
  Check,
  UserCheck,
  UserX,
  Crown,
  Copy,
  Users,
} from 'lucide-react';

export interface GroupRosterMember {
  _id: Id<'groupMembers'>;
  name: string;
  userId?: string | null;
  claimedByUserId?: string | null;
}

interface AddMemberModalProps {
  isOpen: boolean;
  onClose: () => void;
  groupId: Id<'groups'>;
  members?: GroupRosterMember[];
  groupOwnerId?: string;
}

type RosterFilter = 'all' | 'claimed' | 'unclaimed';

function getLinkedUserId(member: GroupRosterMember): string | null {
  const raw = member.userId ?? member.claimedByUserId;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower === 'unclaimed' || lower === 'none' || lower === 'null' || lower === 'undefined') {
    return null;
  }
  return trimmed;
}

export const AddMemberModal: React.FC<AddMemberModalProps> = ({
  isOpen,
  onClose,
  groupId,
  members = [],
  groupOwnerId,
}) => {
  const { user } = useUser();
  const clerkUserId = user?.id ?? null;

  const addMemberMutation = useMutation(
    (api as any).groups?.addMember || (api as any).groups?.addGroupMember
  );
  const claimMemberMutation = useMutation(
    (api as any).groups?.claimMember || (api as any).groups?.claimGroupMember
  );

  const [name, setName] = useState('');
  const [filter, setFilter] = useState<RosterFilter>('all');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const claimedCount = useMemo(
    () => members.filter((m) => Boolean(getLinkedUserId(m))).length,
    [members]
  );

  const unclaimedCount = useMemo(
    () => members.filter((m) => !getLinkedUserId(m)).length,
    [members]
  );

  const currentUserAlreadyClaimed = useMemo(
    () => Boolean(clerkUserId && members.some((m) => getLinkedUserId(m) === clerkUserId)),
    [clerkUserId, members]
  );

  const visibleMembers = useMemo(() => {
    return members.filter((m) => {
      const linked = getLinkedUserId(m);
      if (filter === 'claimed') return Boolean(linked);
      if (filter === 'unclaimed') return !linked;
      return true;
    });
  }, [members, filter]);

  if (!isOpen) return null;

  const handleCopyGroupId = () => {
    navigator.clipboard.writeText(String(groupId));
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const handleClaim = async (memberId: Id<'groupMembers'>) => {
    setClaimingId(memberId);
    setErrorMsg(null);
    try {
      await claimMemberMutation({ groupId, memberId });
    } catch (err: any) {
      console.error('Failed to claim member:', err);
      const serverMsg = err?.message?.replace(/^Uncaught Error:\s*/, '');
      setErrorMsg(serverMsg || 'Could not claim this member slot.');
    } finally {
      setClaimingId(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const trimmed = name.trim();
    if (!trimmed) {
      setErrorMsg('Please enter a name.');
      return;
    }

    setIsSubmitting(true);
    try {
      await addMemberMutation({
        groupId,
        name: trimmed,
      });
      setName('');
      setErrorMsg(null);
    } catch (err: any) {
      console.error('Failed to add member:', err);
      const serverMsg = err?.message?.replace(/^Uncaught Error:\s*/, '');
      setErrorMsg(serverMsg || 'Failed to add member. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-2xl p-6 space-y-5 font-sans max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900 leading-tight">
                People &amp; Claim Status
              </h3>
              <p className="text-[11px] text-slate-400 font-medium">
                {members.length} total · {claimedCount} claimed · {unclaimedCount} unclaimed
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
            title="Close (never mind)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Add New Person Form */}
        <form onSubmit={handleSubmit} className="space-y-2">
          <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">
            Add Person
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="e.g. Elena, Marco, Guest"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1 min-w-0 px-4 py-2.5 rounded-2xl bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 text-sm font-medium"
            />
            <button
              type="submit"
              disabled={isSubmitting || !name.trim()}
              className="px-4 py-2.5 rounded-2xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-bold text-xs shadow-sm transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
            >
              <Check className="w-4 h-4" />
              <span>{isSubmitting ? 'Adding…' : 'Add'}</span>
            </button>
          </div>
          <p className="text-[10px] text-slate-400 truncate">
            Added people start unclaimed so you can split expenses right away.
          </p>
        </form>

        {/* Current Roster & Claim Status */}
        <div className="space-y-3 pt-3 border-t border-slate-100">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-slate-400" />
              Current Roster ({members.length})
            </span>
            <button
              type="button"
              onClick={handleCopyGroupId}
              className="px-2.5 py-1 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-600 text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-colors"
            >
              {copiedId ? (
                <>
                  <Check className="w-3 h-3 text-emerald-600" />
                  <span className="text-emerald-700">Group ID Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span>Copy Group ID</span>
                </>
              )}
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-100 text-[11px] font-bold">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`py-1.5 rounded-lg transition-all cursor-pointer ${
                filter === 'all'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              All ({members.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('claimed')}
              className={`py-1.5 rounded-lg transition-all cursor-pointer ${
                filter === 'claimed'
                  ? 'bg-white text-emerald-700 shadow-xs'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Claimed ({claimedCount})
            </button>
            <button
              type="button"
              onClick={() => setFilter('unclaimed')}
              className={`py-1.5 rounded-lg transition-all cursor-pointer ${
                filter === 'unclaimed'
                  ? 'bg-white text-amber-700 shadow-xs'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Unclaimed ({unclaimedCount})
            </button>
          </div>

          <div className="space-y-2 max-h-60 overflow-y-auto pr-0.5">
            {visibleMembers.length === 0 ? (
              <p className="text-xs text-slate-400 italic text-center py-4">
                No members in this filter.
              </p>
            ) : (
              visibleMembers.map((m) => {
                const linkedUserId = getLinkedUserId(m);
                const isClaimed = Boolean(linkedUserId);
                const isMe = Boolean(clerkUserId && linkedUserId === clerkUserId);
                const isOwner = Boolean(groupOwnerId && linkedUserId === groupOwnerId);

                return (
                  <div
                    key={m._id}
                    className="p-3 rounded-2xl bg-slate-50/90 border border-slate-100 flex items-center justify-between gap-2"
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
                          {isMe && (
                            <span className="px-1.5 py-0.5 rounded-md bg-slate-900 text-white text-[9px] font-bold uppercase">
                              You
                            </span>
                          )}
                          {isOwner && (
                            <span className="px-1.5 py-0.5 rounded-md bg-indigo-100 text-indigo-700 text-[9px] font-bold flex items-center gap-0.5">
                              <Crown className="w-2.5 h-2.5" />
                              Owner
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5">
                          {isClaimed ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700">
                              <UserCheck className="w-3 h-3" />
                              Claimed
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700">
                              <UserX className="w-3 h-3" />
                              Unclaimed
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {!isClaimed && clerkUserId && !currentUserAlreadyClaimed && (
                      <button
                        type="button"
                        disabled={claimingId === m._id}
                        onClick={() => handleClaim(m._id)}
                        className="px-2.5 py-1 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-900 text-[10px] font-bold cursor-pointer transition-colors disabled:opacity-50 shrink-0"
                      >
                        {claimingId === m._id ? 'Claiming…' : 'Claim as Me'}
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {errorMsg && (
          <p className="text-rose-600 text-xs font-semibold bg-rose-50 border border-rose-200 rounded-2xl px-3 py-2">
            {errorMsg}
          </p>
        )}
      </div>
    </div>
  );
};