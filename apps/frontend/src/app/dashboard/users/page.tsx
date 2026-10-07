'use client';

import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { Copy, Users, Plus, Search, UserPlus, Key, Pencil, Trash2, RefreshCw, X, ArrowUpDown, ArrowUp, ArrowDown, Upload, Download, AlertTriangle, XCircle } from 'lucide-react';
import { api, useAuth } from '@/contexts/auth-context';
import { useBranding } from '@/contexts/branding-context';
import { useConfirm } from '@/components/confirm-provider';
import { useToast } from '@/components/toast-provider';
import { downloadBlob } from '@/lib/download';

interface TeamLead {
  id: string;
  username: string;
  fullName?: string;
}

export default function UsersPage() {
  const { user } = useAuth();
  const { roleAccentColors } = useBranding();
  const confirmDialog = useConfirm();
  const showToast = useToast();
  const [users, setUsers] = useState<any[]>([]);
  const [teamLeads, setTeamLeads] = useState<TeamLead[]>([]);
  const [managers, setManagers] = useState<TeamLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [newUser, setNewUser] = useState({ username: '', email: '', role: 'TESTER', assignedTlId: '', managerId: '', fullName: '', phone: '', designation: '' });
  const [sortField, setSortField] = useState<string>('username');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [message, setMessage] = useState('');
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);

  // Bulk upload state
  const [showBulkError, setShowBulkError] = useState(false);
  const [bulkErrorMsg, setBulkErrorMsg] = useState('');
  const [bulkUploading, setBulkUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user?.role === 'ADMIN') {
      fetchUsers();
      fetchTeamLeads();
      fetchManagers();
    }
  }, [user]);

  const fetchUsers = async () => {
    try {
      const response = await api.get('/users');
      setUsers(response.data);
    } catch (error) {
      console.error('Failed to fetch users:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchTeamLeads = async () => {
    try {
      const response = await api.get('/users/team-leads');
      setTeamLeads(response.data);
    } catch (error) {
      console.error('Failed to fetch team leads:', error);
    }
  };

  const fetchManagers = async () => {
    try {
      const response = await api.get('/users/managers');
      setManagers(response.data);
    } catch (error) {
      console.error('Failed to fetch managers:', error);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.post('/users', newUser);
      setShowAddModal(false);
      setNewUser({ username: '', email: '', role: 'TESTER', assignedTlId: '', managerId: '', fullName: '', phone: '', designation: '' });
      fetchUsers();
      setCopyFailed(false);
      setTempPassword(res.data.tempPassword);
      showToast('User created. Share the one-time temporary password with them.');
    } catch (error: any) {
      showToast(error.response?.data?.message || 'Failed to create user', 'error');
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    try {
      await api.put(`/users/${editingUser.id}`, {
        username: editingUser.username,
        email: editingUser.email,
        role: editingUser.role,
        assignedTlId: editingUser.assignedTlId,
        fullName: editingUser.fullName,
        phone: editingUser.phone,
        designation: editingUser.designation,
        managerId: editingUser.managerId,
      });
      setShowEditModal(false);
      setEditingUser(null);
      fetchUsers();
    } catch (error) {
      console.error('Failed to update user:', error);
    }
  };

  const handleDelete = async (userId: string) => {
    const ok = await confirmDialog({
      title: 'Delete user?',
      message: 'They will no longer be able to log in. This will also permanently delete all of their projects, along with the generated reports, issue logs, and PoC attachments for those projects. The user will disappear from this list 24 hours from now.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await api.delete(`/users/${userId}`);
      const count = res.data?.projectsDeleted ?? 0;
      showToast(count > 0 ? `User deleted. ${count} project(s) permanently deleted.` : 'User deleted.', 'success');
      fetchUsers();
    } catch (error: any) {
      showToast(error.response?.data?.message || 'Failed to delete user', 'error');
    }
  };

  const handleActivate = async (userId: string) => {
    try {
      await api.put(`/users/${userId}/activate`, {});
      fetchUsers();
    } catch (error) {
      console.error('Failed to activate user:', error);
    }
  };

  const handleResetPassword = async (userId: string) => {
    try {
      const response = await api.post(`/users/${userId}/reset-password`);
      setCopyFailed(false);
      setTempPassword(response.data.tempPassword);
    } catch (error) {
      console.error('Failed to reset password:', error);
    }
  };

  // Copy, then close. If the clipboard is blocked the dialog stays open —
  // the password is only shown once, so closing would lose it.
  const copyTempPassword = async () => {
    try {
      await navigator.clipboard.writeText(tempPassword!);
      setTempPassword(null);
      showToast('Temporary password copied.', 'success');
    } catch {
      setCopyFailed(true);
    }
  };

  // ─── Bulk Upload ───
  // Temp passwords exist only in this response, so hand them to the admin as a file right away.
  const downloadCredentialsCsv = (rows: { fullName: string; email: string; username: string; tempPassword: string }[]) => {
    // Leading =,+,-,@ would be read as a formula when the file is opened in Excel/Sheets.
    const cell = (v: string) => `"${(/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`;
    const csv = ['Full Name,Email,Username,Temporary Password', ...rows.map((r) => [r.fullName, r.email, r.username, r.tempPassword].map(cell).join(','))].join('\n');
    downloadBlob(new Blob([csv], { type: 'text/csv' }), 'new-user-credentials.csv');
  };

  const handleBulkUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;

    const name = file.name.toLowerCase();
    if (!name.endsWith('.csv') && !name.endsWith('.xlsx')) {
      setBulkErrorMsg('Only .csv and .xlsx files are allowed. Please upload a valid file.');
      setShowBulkError(true);
      return;
    }

    // File content is validated and parsed server-side only — nothing here
    // is read or executed client-side, it's just handed off as data.
    setBulkUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await api.post('/users/bulk-upload', formData, {
        headers: { 'Content-Type': undefined },
      });
      const { added, skipped, errors, credentials } = response.data;
      if (credentials?.length) downloadCredentialsCsv(credentials);
      let msg = `Bulk upload complete: ${added} added`;
      if (skipped > 0) msg += `, ${skipped} skipped (already exist)`;
      if (errors.length > 0) msg += `, ${errors.length} errors`;
      setMessage(msg);
      fetchUsers();
    } catch (error: any) {
      const msg = error.response?.data?.message || 'Upload failed';
      setBulkErrorMsg(msg);
      setShowBulkError(true);
    } finally {
      setBulkUploading(false);
    }
  };

  const downloadSampleCsv = () => {
    window.open('/api/users/sample-csv', '_blank');
  };

  const openEditModal = (u: any) => {
    setEditingUser({ ...u });
    setShowEditModal(true);
  };

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const sortedUsers = [...users].sort((a, b) => {
    let aVal: any, bVal: any;
    if (sortField === 'user') {
      aVal = (a.fullName || a.username || '').toLowerCase();
      bVal = (b.fullName || b.username || '').toLowerCase();
    } else if (sortField === 'role') {
      aVal = (a.role || '').toLowerCase();
      bVal = (b.role || '').toLowerCase();
    } else if (sortField === 'teamLead') {
      const aTl = teamLeads.find(tl => tl.id === a.assignedTlId);
      const bTl = teamLeads.find(tl => tl.id === b.assignedTlId);
      aVal = (aTl?.fullName || aTl?.username || '').toLowerCase();
      bVal = (bTl?.fullName || bTl?.username || '').toLowerCase();
    } else {
      aVal = (a[sortField] || '').toString().toLowerCase();
      bVal = (b[sortField] || '').toString().toLowerCase();
    }
    if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
    return 0;
  });

  const filteredUsers = sortedUsers.filter(u =>
    !search ||
    u.username.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    u.fullName?.toLowerCase().includes(search.toLowerCase())
  );

  if (user?.role !== 'ADMIN') {
    return (
      <div className="text-center py-12">
        <p className="text-red-400">Access denied. Admin privileges required.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">User Management</h1>
          <p className="text-gray-400 text-sm mt-1">Manage team members and access</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="file"
            accept=".csv,.xlsx"
            ref={fileInputRef}
            onChange={handleFileSelect}
            className="hidden"
          />
          <button
            onClick={handleBulkUploadClick}
            disabled={bulkUploading}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 border border-purple-500/20 rounded-lg transition-all text-sm disabled:opacity-50"
          >
            <Upload className="w-4 h-4" />
            {bulkUploading ? 'Uploading...' : 'Bulk Upload'}
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-all"
          >
            <UserPlus className="w-4 h-4" />
            Add User
          </button>
        </div>
      </div>

      {message && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className={`p-3 rounded-lg ${message.includes('complete') || message.includes('added') ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
          {message}
        </motion.div>
      )}

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input
          type="text"
          placeholder="Search users..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2 rounded-lg bg-gray-800/50 border border-gray-700 focus:border-emerald-500 transition-all"
        />
      </div>

      {/* Users Table */}
      <div className="glass-card rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-700">
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-400 cursor-pointer hover:text-white" onClick={() => handleSort('user')}>
                <div className="flex items-center gap-1">User {sortField === 'user' ? (sortOrder === 'asc' ? <ArrowUp className="w-3 h-3 text-emerald-400" /> : <ArrowDown className="w-3 h-3 text-emerald-400" />) : <ArrowUpDown className="w-3 h-3 text-gray-600" />}</div>
              </th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-400 cursor-pointer hover:text-white" onClick={() => handleSort('role')}>
                <div className="flex items-center gap-1">Role {sortField === 'role' ? (sortOrder === 'asc' ? <ArrowUp className="w-3 h-3 text-emerald-400" /> : <ArrowDown className="w-3 h-3 text-emerald-400" />) : <ArrowUpDown className="w-3 h-3 text-gray-600" />}</div>
              </th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-400 cursor-pointer hover:text-white" onClick={() => handleSort('teamLead')}>
                <div className="flex items-center gap-1">Team Lead {sortField === 'teamLead' ? (sortOrder === 'asc' ? <ArrowUp className="w-3 h-3 text-emerald-400" /> : <ArrowDown className="w-3 h-3 text-emerald-400" />) : <ArrowUpDown className="w-3 h-3 text-gray-600" />}</div>
              </th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Phone</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Status</th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-400">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map((u, i) => (
              <motion.tr
                key={u.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.03 }}
                className="border-b border-gray-700/50 hover:bg-white/5 transition-colors"
              >
                <td className="px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-white">{u.fullName || u.username}</p>
                    <p className="text-xs text-gray-400">{u.email}</p>
                    {u.designation && <p className="text-xs text-gray-500">{u.designation}</p>}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span
                    className="px-2 py-0.5 rounded-full text-xs font-medium"
                    style={{
                      backgroundColor: `${roleAccentColors[u.role] || '#6b7280'}1a`,
                      color: roleAccentColors[u.role] || '#9ca3af',
                    }}
                  >
                    {u.role}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-400">
                  {u.assignedTlId ? teamLeads.find(tl => tl.id === u.assignedTlId)?.fullName || teamLeads.find(tl => tl.id === u.assignedTlId)?.username || 'Unknown' : 'N/A'}
                </td>
                <td className="px-4 py-3 text-sm text-gray-400">{u.phone || 'N/A'}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${
                    u.isActive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-gray-700 text-gray-400'
                  }`}>
                    {u.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openEditModal(u)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-all"
                      title="Edit"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleResetPassword(u.id)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-amber-400 hover:bg-amber-500/10 transition-all"
                      title="Reset Password"
                    >
                      <Key className="w-3.5 h-3.5" />
                    </button>
                    {u.isActive ? (
                      <button
                        onClick={() => handleDelete(u.id)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-all"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <button
                        onClick={() => handleActivate(u.id)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-all"
                        title="Activate"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add User Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-card rounded-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto"
          >
            <h2 className="text-lg font-semibold text-white mb-4">Add New User</h2>
            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-300 mb-1">Username</label>
                <input type="text" required value={newUser.username}
                  onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700" />
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Email</label>
                <input type="email" required value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700" />
              </div>
              <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 px-3 py-2 text-xs text-emerald-300">
                A random temporary password is generated and shown once after creation. The user must change it on first login.
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Full Name</label>
                <input type="text" value={newUser.fullName}
                  onChange={(e) => setNewUser({ ...newUser, fullName: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Phone</label>
                  <input type="text" value={newUser.phone}
                    onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700" />
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Designation</label>
                  <input type="text" value={newUser.designation}
                    onChange={(e) => setNewUser({ ...newUser, designation: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700" />
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-300 mb-1">Role</label>
                <select value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700">
                  <option value="TESTER">Tester</option>
                  <option value="TEAM_LEAD">Team Lead</option>
                  <option value="AVP">AVP</option>
                  <option value="ADMIN">Admin</option>
                </select>
              </div>
              {newUser.role === 'TESTER' && (
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Assigned Team Lead</label>
                  <select value={newUser.assignedTlId}
                    onChange={(e) => setNewUser({ ...newUser, assignedTlId: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700">
                    <option value="">Select Team Lead</option>
                    {teamLeads.map(tl => (
                      <option key={tl.id} value={tl.id}>{tl.fullName || tl.username}</option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm text-gray-300 mb-1">Manager</label>
                <select value={newUser.managerId}
                  onChange={(e) => setNewUser({ ...newUser, managerId: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700">
                  <option value="">None</option>
                  {managers.map(m => (
                    <option key={m.id} value={m.id}>{m.fullName || m.username}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowAddModal(false)}
                  className="flex-1 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white transition-all">Cancel</button>
                <button type="submit"
                  className="flex-1 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-all">Create</button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Edit User Modal — rendered via portal so it isn't clipped by the
          page-transition wrapper's animated filter/transform, which creates
          a containing block that breaks position:fixed centering/sizing. */}
      {showEditModal && editingUser && createPortal(
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-card rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Edit User: {editingUser.username}</h2>
              <button onClick={() => setShowEditModal(false)} className="p-1 rounded-lg text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleUpdateUser} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Full Name</label>
                  <input type="text" value={editingUser.fullName || ''}
                    onChange={(e) => setEditingUser({ ...editingUser, fullName: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700" />
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Username</label>
                  <input type="text" required value={editingUser.username}
                    onChange={(e) => setEditingUser({ ...editingUser, username: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Email</label>
                  <input type="email" required value={editingUser.email}
                    onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700" />
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Phone</label>
                  <input type="text" value={editingUser.phone || ''}
                    onChange={(e) => setEditingUser({ ...editingUser, phone: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Role</label>
                  <select value={editingUser.role}
                    onChange={(e) => setEditingUser({ ...editingUser, role: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700">
                    <option value="TESTER">Tester</option>
                    <option value="TEAM_LEAD">Team Lead</option>
                    <option value="AVP">AVP</option>
                    <option value="ADMIN">Admin</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Designation</label>
                  <input type="text" value={editingUser.designation || ''}
                    onChange={(e) => setEditingUser({ ...editingUser, designation: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Team Lead</label>
                  <select value={editingUser.assignedTlId || ''}
                    onChange={(e) => setEditingUser({ ...editingUser, assignedTlId: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700">
                    <option value="">None</option>
                    {teamLeads.map(tl => (
                      <option key={tl.id} value={tl.id}>{tl.fullName || tl.username}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Manager</label>
                  <select value={editingUser.managerId || ''}
                    onChange={(e) => setEditingUser({ ...editingUser, managerId: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700">
                    <option value="">None</option>
                    {managers.map(m => (
                      <option key={m.id} value={m.id}>{m.fullName || m.username}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowEditModal(false)}
                  className="flex-1 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white transition-all">Cancel</button>
                <button type="submit"
                  className="flex-1 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-all">Save</button>
              </div>
            </form>
          </motion.div>
        </div>,
        document.body
      )}

      {/* Bulk Upload Error Modal */}
      {showBulkError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-gray-900 rounded-2xl border border-gray-700 w-full max-w-md"
          >
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
                    <XCircle className="w-5 h-5 text-red-400" />
                  </div>
                  <h2 className="text-lg font-semibold text-white">Upload Rejected</h2>
                </div>
                <button onClick={() => setShowBulkError(false)} className="p-1 rounded-lg hover:bg-gray-800 text-gray-400">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <p className="text-gray-400 text-sm mb-4">
                {bulkErrorMsg}
              </p>
              <p className="text-gray-500 text-xs mb-6">
                Please make sure your file follows the exact format required (.csv or .xlsx, no macros/formulas). You can download a sample file below to see the correct structure.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowBulkError(false)}
                  className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm"
                >
                  Close
                </button>
                <button
                  onClick={downloadSampleCsv}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Download Sample CSV
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {tempPassword && (
        <div className="fixed inset-0 z-[300] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="temp-password-title"
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="w-full max-w-sm rounded-xl border border-gray-700 bg-gray-900/90 backdrop-blur-md shadow-2xl p-5"
          >
            <p id="temp-password-title" className="text-sm font-semibold text-white">Temporary password</p>
            <p className="text-sm text-gray-400 mt-1">Shown only once. Copy it now and share it with the user.</p>
            <div className="mt-4 p-3 rounded-lg bg-gray-800/50 border border-gray-700 font-mono text-sm text-emerald-400 break-all select-all">
              {tempPassword}
            </div>
            {copyFailed && (
              <p className="mt-2 text-xs text-red-400">Couldn&apos;t access the clipboard. Select the password above and copy it manually.</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              {copyFailed && (
                <button
                  onClick={() => { setTempPassword(null); setCopyFailed(false); }}
                  className="px-4 py-1.5 rounded-lg text-sm text-gray-300 hover:bg-white/5 transition-colors"
                >
                  Close
                </button>
              )}
              <button
                autoFocus
                onClick={copyTempPassword}
                className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:outline-none"
              >
                <Copy className="w-4 h-4" />
                Copy
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
