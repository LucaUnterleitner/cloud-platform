import { useState, useEffect, type FormEvent } from 'react'
import { Users, UserPlus, Shield, Trash2, RefreshCw, AlertCircle, Gauge, Save } from 'lucide-react'
import { organizationsApi, quotasApi } from '../services/api'
import { useAuthStore } from '../stores/authStore'

interface Member {
  id: string
  user_id: string
  role: string
  joined_at: string
  user: {
    id: string
    email: string
    username: string
    first_name?: string
    last_name?: string
  }
}

export default function OrganizationSettingsPage() {
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { currentOrganization, organizations, user } = useAuthStore()

  // "Add user" form state
  const [showAddUser, setShowAddUser] = useState(false)
  const [addUserBusy, setAddUserBusy] = useState(false)
  const [addUserError, setAddUserError] = useState<string | null>(null)
  const [addUserInfo, setAddUserInfo] = useState<string | null>(null)
  // Personal quota ("was darf dieser Benutzer verbrauchen")
  const QUOTA_FIELDS = [
    { key: 'cpu_cores', label: 'vCPU', step: 1, unit: 'Kerne' },
    { key: 'memory_gb', label: 'RAM', step: 1, unit: 'GB' },
    { key: 'storage_gb', label: 'Storage', step: 10, unit: 'GB' },
    { key: 'vm_count', label: 'VMs', step: 1, unit: 'Stück' },
  ] as const
  const [quotaOpenFor, setQuotaOpenFor] = useState<string | null>(null)
  const [quotaSaving, setQuotaSaving] = useState(false)
  const [quotaError, setQuotaError] = useState<string | null>(null)
  const [memberQuotas, setMemberQuotas] = useState<Record<string, Record<string, { limit: number | null; used: number }>>>({})
  const [quotaDraft, setQuotaDraft] = useState<Record<string, string>>({})

  const [newUser, setNewUser] = useState({
    email: '',
    username: '',
    password: '',
    role: 'member',
    first_name: '',
    last_name: '',
  })

  const currentMembership = organizations.find(
    o => o.organization.id === currentOrganization?.id
  )
  const isAdmin = currentMembership?.role === 'admin' || user?.is_superadmin

  useEffect(() => {
    if (currentOrganization) {
      loadMembers()
    }
  }, [currentOrganization])

  const loadMembers = async () => {
    if (!currentOrganization) return

    try {
      setLoading(true)
      setError(null)
      const data = await organizationsApi.listMembers()
      setMembers(data)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to load members')
    } finally {
      setLoading(false)
    }
  }

  const loadMemberQuotas = async () => {
    try {
      const data = await quotasApi.getMemberQuotas()
      const map: Record<string, Record<string, { limit: number | null; used: number }>> = {}
      data.forEach((entry) => {
        map[entry.user_id] = {}
        entry.resources.forEach((r) => {
          map[entry.user_id][r.resource_type] = { limit: r.limit, used: r.used }
        })
      })
      setMemberQuotas(map)
    } catch {
      // Quota overview is optional – ignore errors here
    }
  }

  useEffect(() => {
    if (isAdmin) loadMemberQuotas()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members.length, isAdmin])

  const openQuotaEditor = (member: Member) => {
    setQuotaError(null)
    setQuotaOpenFor(quotaOpenFor === member.user_id ? null : member.user_id)
    const current = memberQuotas[member.user_id] || {}
    const draft: Record<string, string> = {}
    QUOTA_FIELDS.forEach((f) => {
      const v = current[f.key]?.limit
      draft[f.key] = v === null || v === undefined ? '' : String(v)
    })
    setQuotaDraft(draft)
  }

  const saveQuota = async (userId: string) => {
    setQuotaSaving(true)
    setQuotaError(null)
    try {
      for (const field of QUOTA_FIELDS) {
        const raw = (quotaDraft[field.key] ?? '').trim()
        const value = raw === '' ? null : Number(raw)
        if (value !== null && (Number.isNaN(value) || value < 0)) {
          throw new Error(`${field.label}: bitte eine Zahl ≥ 0 eingeben oder leer lassen.`)
        }
        await quotasApi.setUserQuota(userId, field.key, value)
      }
      await loadMemberQuotas()
      setQuotaOpenFor(null)
    } catch (err: any) {
      const detail = err?.response?.data?.detail
      setQuotaError(
        typeof detail === 'string'
          ? detail
          : err?.message || 'Kontingent konnte nicht gespeichert werden.'
      )
    } finally {
      setQuotaSaving(false)
    }
  }

  const handleUpdateRole = async (userId: string, newRole: string) => {
    if (!currentOrganization || !isAdmin) return

    try {
      await organizationsApi.updateMemberRole(userId, newRole)
      loadMembers()
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to update member role')
    }
  }

  const handleRemoveMember = async (userId: string) => {
    if (!currentOrganization || !isAdmin) return

    if (!confirm('Are you sure you want to remove this member?')) return

    try {
      await organizationsApi.removeMember(userId)
      loadMembers()
    } catch (err: any) {
      alert(err.response?.data?.detail || 'Failed to remove member')
    }
  }

  const handleCreateUser = async (e: FormEvent) => {
    e.preventDefault()
    if (!isAdmin) return

    setAddUserBusy(true)
    setAddUserError(null)
    setAddUserInfo(null)

    try {
      const created = await organizationsApi.createUser({
        email: newUser.email.trim(),
        username: newUser.username.trim() || undefined,
        password: newUser.password || undefined,
        role: newUser.role,
        first_name: newUser.first_name.trim() || undefined,
        last_name: newUser.last_name.trim() || undefined,
      })
      setAddUserInfo(
        `${created.user?.email || newUser.email} wurde hinzugefügt (Rolle: ${created.role}).`
      )
      setNewUser({ email: '', username: '', password: '', role: 'member', first_name: '', last_name: '' })
      setShowAddUser(false)
      loadMembers()
    } catch (err: any) {
      const detail = err.response?.data?.detail
      if (typeof detail === 'string') setAddUserError(detail)
      else if (Array.isArray(detail)) setAddUserError(detail.map((d: any) => d.msg).join('; '))
      else if (err.response?.status === 403) setAddUserError('Keine Berechtigung: nur Org-Admins dürfen Benutzer anlegen.')
      else setAddUserError(err.response ? `Fehler (HTTP ${err.response.status})` : 'Server nicht erreichbar.')
    } finally {
      setAddUserBusy(false)
    }
  }

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin':
        return 'bg-purple-100 text-purple-800 border-purple-200'
      case 'member':
        return 'bg-blue-100 text-blue-800 border-blue-200'
      case 'viewer':
        return 'bg-gray-100 text-gray-800 border-gray-200'
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200'
    }
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start">
          <AlertCircle className="w-5 h-5 text-red-500 mr-3 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-medium text-red-800">Error loading organization</h3>
            <p className="text-sm text-red-700 mt-1">{error}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Organization Settings</h1>
        <p className="text-gray-600 mt-2">{currentOrganization?.name}</p>
      </div>

      {/* Organization Info Card */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Organization Details</h2>
        <div className="space-y-3">
          <div>
            <p className="text-sm text-gray-600">Name</p>
            <p className="text-base font-medium text-gray-900">{currentOrganization?.name}</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Slug</p>
            <p className="text-base font-mono text-gray-900">{currentOrganization?.slug}</p>
          </div>
          {currentOrganization?.description && (
            <div>
              <p className="text-sm text-gray-600">Description</p>
              <p className="text-base text-gray-900">{currentOrganization.description}</p>
            </div>
          )}
        </div>
      </div>

      {/* Members Section */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <Users className="w-6 h-6 text-gray-700 mr-3" />
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Members</h2>
                <p className="text-sm text-gray-600 mt-1">{members.length} total members</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={loadMembers}
                className="flex items-center px-4 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh
              </button>
              {isAdmin && (
                <button
                  onClick={() => { setShowAddUser(v => !v); setAddUserError(null); setAddUserInfo(null) }}
                  className="flex items-center px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                >
                  <UserPlus className="w-4 h-4 mr-2" />
                  Benutzer hinzufügen
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Add user form */}
        {showAddUser && isAdmin && (
          <form onSubmit={handleCreateUser} className="p-6 border-b border-gray-200 bg-gray-50">
            <h3 className="text-base font-semibold text-gray-900 mb-1">Neuen Benutzer anlegen</h3>
            <p className="text-sm text-gray-600 mb-4">
              Existiert die E-Mail bereits, wird der Benutzer nur dieser Organisation hinzugefügt.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">E-Mail *</label>
                <input
                  type="email" required value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  placeholder="vorname.nachname@lab.net"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Rolle *</label>
                <select
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                >
                  <option value="member">member – VMs erstellen/verwalten</option>
                  <option value="admin">admin – zusätzlich Benutzer &amp; Quotas</option>
                  <option value="viewer">viewer – nur ansehen</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Benutzername</label>
                <input
                  type="text" value={newUser.username}
                  onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                  placeholder="leer = aus E-Mail ableiten"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Initialpasswort {newUser.email ? '' : '(nur neue Benutzer)'}
                </label>
                <input
                  type="text" value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  placeholder="mind. 8 Zeichen"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Vorname</label>
                <input
                  type="text" value={newUser.first_name}
                  onChange={(e) => setNewUser({ ...newUser, first_name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nachname</label>
                <input
                  type="text" value={newUser.last_name}
                  onChange={(e) => setNewUser({ ...newUser, last_name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
              </div>
            </div>

            {addUserError && (
              <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-start">
                <AlertCircle className="w-4 h-4 text-red-500 mr-2 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{addUserError}</p>
              </div>
            )}

            <div className="mt-4 flex items-center gap-3">
              <button
                type="submit" disabled={addUserBusy}
                className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {addUserBusy ? 'Wird angelegt…' : 'Benutzer anlegen'}
              </button>
              <button
                type="button" onClick={() => setShowAddUser(false)}
                className="px-4 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Abbrechen
              </button>
            </div>
          </form>
        )}

        {addUserInfo && (
          <div className="p-4 bg-green-50 border-b border-green-200">
            <p className="text-sm text-green-800">{addUserInfo}</p>
          </div>
        )}

        {/* Members List */}
        <div className="divide-y divide-gray-200">
          {members.map((member) => (
            <div key={member.id} className="p-6 hover:bg-gray-50 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center flex-1 min-w-0">
                  <div className="flex-shrink-0">
                    <div className="w-12 h-12 rounded-full bg-indigo-600 flex items-center justify-center text-white font-semibold text-lg">
                      {member.user.first_name?.[0] || member.user.username[0].toUpperCase()}
                    </div>
                  </div>
                  <div className="ml-4 flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <p className="text-base font-medium text-gray-900 truncate">
                        {member.user.first_name && member.user.last_name
                          ? `${member.user.first_name} ${member.user.last_name}`
                          : member.user.username}
                      </p>
                      <span
                        className={`px-3 py-1 text-xs font-medium rounded-full border ${getRoleBadgeColor(member.role)}`}
                      >
                        {member.role}
                      </span>
                      {member.user_id === user?.id && (
                        <span className="px-2 py-1 text-xs font-medium text-green-700 bg-green-100 rounded-full">
                          You
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600 truncate">{member.user.email}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      Joined {new Date(member.joined_at).toLocaleDateString()}
                    </p>
                    <p className="text-xs mt-1">
                      <span className="text-gray-500">Kontingent: </span>
                      {(() => {
                        const q = memberQuotas[member.user_id]
                        if (!q) return <span className="text-gray-400">–</span>
                        const parts = QUOTA_FIELDS.filter((f) => q[f.key]?.limit !== null && q[f.key]?.limit !== undefined).map(
                          (f) => `${q[f.key].limit} ${f.label}`
                        )
                        return parts.length > 0 ? (
                          <span className="font-medium text-gray-700">{parts.join(' / ')}</span>
                        ) : (
                          <span className="text-gray-400">unbegrenzt (Org-Kontingent)</span>
                        )
                      })()}
                    </p>
                  </div>
                </div>

                {/* Actions (only for admins) */}
                {isAdmin && (
                  <button
                    onClick={() => openQuotaEditor(member)}
                    className="ml-3 flex items-center px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                    title="Persönliches Kontingent festlegen"
                  >
                    <Gauge className="w-4 h-4 mr-1.5" />
                    Kontingent
                  </button>
                )}

                {isAdmin && member.user_id !== user?.id && (
                  <div className="flex items-center gap-2 ml-4">
                    <select
                      value={member.role}
                      onChange={(e) => handleUpdateRole(member.user_id, e.target.value)}
                      className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    >
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    <button
                      onClick={() => handleRemoveMember(member.user_id)}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Remove member"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                )}
              </div>

              {/* Personal quota editor */}
              {isAdmin && quotaOpenFor === member.user_id && (
                <div className="mt-4 rounded-lg border border-indigo-200 bg-indigo-50/50 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">
                        Persönliches Kontingent für {member.user.username}
                      </p>
                      <p className="text-xs text-gray-600 mt-0.5">
                        Leer lassen = unbegrenzt (nur durch das Organisations-Kontingent begrenzt).
                        Ein persönliches Limit kann das Org-Limit nur verschärfen, nie erweitern.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {QUOTA_FIELDS.map((field) => {
                      const current = memberQuotas[member.user_id]?.[field.key]
                      return (
                        <div key={field.key}>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            {field.label}
                          </label>
                          <input
                            type="number"
                            min="0"
                            step={field.step}
                            value={quotaDraft[field.key] ?? ''}
                            onChange={(e) =>
                              setQuotaDraft({ ...quotaDraft, [field.key]: e.target.value })
                            }
                            placeholder="unbegrenzt"
                            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          />
                          <p className="text-xs text-gray-500 mt-1">
                            belegt: {current ? Math.round(current.used * 100) / 100 : 0} {field.label}
                          </p>
                        </div>
                      )
                    })}
                  </div>

                  {quotaError && (
                    <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-2 flex items-start">
                      <AlertCircle className="w-4 h-4 text-red-500 mr-2 flex-shrink-0 mt-0.5" />
                      <p className="text-sm text-red-700">{quotaError}</p>
                    </div>
                  )}

                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={() => saveQuota(member.user_id)}
                      disabled={quotaSaving}
                      className="flex items-center px-3 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                    >
                      <Save className="w-4 h-4 mr-2" />
                      {quotaSaving ? 'Speichern…' : 'Kontingent speichern'}
                    </button>
                    <button
                      onClick={() => setQuotaOpenFor(null)}
                      className="px-3 py-2 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                    >
                      Abbrechen
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {members.length === 0 && (
            <div className="p-12 text-center">
              <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">No members found</p>
            </div>
          )}
        </div>
      </div>

      {/* Info Box for Non-Admins */}
      {!isAdmin && (
        <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start">
          <Shield className="w-5 h-5 text-blue-500 mr-3 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-medium text-blue-800">Limited Access</h3>
            <p className="text-sm text-blue-700 mt-1">
              You need admin role to manage organization members. Contact an admin for assistance.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
