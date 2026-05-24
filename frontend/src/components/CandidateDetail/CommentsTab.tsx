import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { getComments, createComment, updateComment, deleteComment } from '../../api/client'
import type { CandidateComment } from '../../api/client'

interface Props {
  candidateId: number
}

export default function CommentsTab({ candidateId }: Props) {
  const [commentText, setCommentText] = useState('')
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null)
  const [editingCommentText, setEditingCommentText] = useState('')

  const { data: commentsList = [], refetch: refetchComments } = useQuery<CandidateComment[]>({
    queryKey: ['comments', candidateId],
    queryFn: () => getComments(candidateId),
    enabled: !!candidateId,
  })

  const addCommentMut = useMutation({
    mutationFn: () => createComment(candidateId, commentText),
    onSuccess: () => { setCommentText(''); refetchComments() },
  })

  const editCommentMut = useMutation({
    mutationFn: (commentId: number) => updateComment(candidateId, commentId, editingCommentText),
    onSuccess: () => { setEditingCommentId(null); setEditingCommentText(''); refetchComments() },
  })

  const deleteCommentMut = useMutation({
    mutationFn: (commentId: number) => deleteComment(candidateId, commentId),
    onSuccess: () => refetchComments(),
  })

  return (
    <div className="p-6 max-w-2xl space-y-4">
      {commentsList.length === 0 && (
        <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">No comments yet. Be the first to add one.</p>
      )}
      <div className="space-y-3">
        {commentsList.map((comment: CandidateComment) => (
          <div key={comment.id} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-[#534AB7]/20 flex items-center justify-center text-[#534AB7] text-xs font-bold">
                  {(comment.author_email ?? '?')[0].toUpperCase()}
                </div>
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{comment.author_email ?? 'Unknown'}</span>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {new Date(comment.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  {comment.updated_at && <span className="ml-1 italic">(edited)</span>}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { setEditingCommentId(comment.id); setEditingCommentText(comment.body) }}
                  className="text-xs text-gray-300 dark:text-gray-600 hover:text-[#534AB7] dark:hover:text-[#AFA9EC] transition-colors"
                >Edit</button>
                <button
                  onClick={() => deleteCommentMut.mutate(comment.id)}
                  className="text-xs text-gray-300 dark:text-gray-600 hover:text-[#E24B4A] transition-colors"
                >Delete</button>
              </div>
            </div>
            {editingCommentId === comment.id ? (
              <div className="space-y-2">
                <textarea
                  rows={3}
                  value={editingCommentText}
                  onChange={(e) => setEditingCommentText(e.target.value)}
                  className="w-full border border-[#534AB7] rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40 resize-none"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => editCommentMut.mutate(comment.id)}
                    disabled={editCommentMut.isPending || !editingCommentText.trim()}
                    className="text-xs bg-[#534AB7] hover:bg-[#3C3489] disabled:opacity-50 text-white rounded-lg px-3 py-1.5 transition-colors"
                  >
                    {editCommentMut.isPending ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={() => { setEditingCommentId(null); setEditingCommentText('') }}
                    className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 px-3 py-1.5 transition-colors"
                  >Cancel</button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{comment.body}</p>
            )}
          </div>
        ))}
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
        <textarea
          rows={3}
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          placeholder="Add a comment visible to all team members…"
          className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#534AB7]/40 resize-none"
        />
        <div className="flex items-center gap-3">
          <button
            onClick={() => addCommentMut.mutate()}
            disabled={addCommentMut.isPending || !commentText.trim()}
            className="bg-[#534AB7] hover:bg-[#3C3489] disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors"
          >
            {addCommentMut.isPending ? 'Posting…' : 'Post Comment'}
          </button>
          {addCommentMut.isError && <span className="text-xs text-red-500">Failed to post comment</span>}
        </div>
      </div>
    </div>
  )
}
