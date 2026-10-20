import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { vmsApi } from '../services/api'

export default function CreateVMFromTemplatePage() {
  const navigate = useNavigate()
  const [error, setError] = useState('')

  const [selectedKey, setSelectedKey] = useState('')
  const [name, setName] = useState('')
  const [hostname, setHostname] = useState('')
  const [description, setDescription] = useState('')
  const [storagePool, setStoragePool] = useState('')
  const [cpuCores, setCpuCores] = useState('')
  const [memoryMb, setMemoryMb] = useState('')
  const [startAfterClone, setStartAfterClone] = useState(true)

  const { data: templates, isLoading, isError } = useQuery({
    queryKey: ['vm-templates'],
    queryFn: () => vmsApi.listTemplates(),
  })

  const selected = (templates || []).find(
    (t) => `${t.cluster_id}:${t.node}:${t.vmid}` === selectedKey
  )

  const cloneMutation = useMutation({
    mutationFn: (payload: any) => vmsApi.createFromTemplate(payload),
    onSuccess: (vm: any) => navigate(`/vms/${vm.id}`),
    onError: (err: any) =>
      setError(err.response?.data?.detail || 'Clone failed'),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!selected) {
      setError('Please select a template')
      return
    }
    if (!name.trim()) {
      setError('Please enter a VM name')
      return
    }

    cloneMutation.mutate({
      name: name.trim(),
      hostname: hostname.trim() || undefined,
      description: description.trim() || undefined,
      template_vmid: selected.vmid,
      template_node: selected.node,
      proxmox_cluster_id: selected.cluster_id,
      storage_pool: storagePool.trim() || undefined,
      cpu_cores: cpuCores ? parseInt(cpuCores, 10) : undefined,
      memory_mb: memoryMb ? parseInt(memoryMb, 10) : undefined,
      start_after_clone: startAfterClone,
    })
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold text-gray-900">New VM from Template</h1>
          <p className="mt-1 text-sm text-gray-600">
            Creates a full clone of a Proxmox template – cloud-init, disks and network are inherited.
          </p>
        </div>
      </header>

      <main className="max-w-3xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="bg-white shadow rounded-lg">
          <form onSubmit={handleSubmit} className="space-y-6 p-6">
            {error && (
              <div className="rounded-md bg-red-50 p-4">
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            {isError && (
              <div className="rounded-md bg-red-50 p-4">
                <p className="text-sm text-red-800">
                  Could not load templates from the Proxmox cluster.
                </p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Template <span className="text-red-500">*</span>
              </label>
              <select
                value={selectedKey}
                onChange={(e) => setSelectedKey(e.target.value)}
                disabled={isLoading}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border text-gray-900"
              >
                <option value="">
                  {isLoading ? 'Loading templates…' : '— select a template —'}
                </option>
                {(templates || []).map((t) => (
                  <option key={`${t.cluster_id}:${t.node}:${t.vmid}`} value={`${t.cluster_id}:${t.node}:${t.vmid}`}>
                    {t.name} (VMID {t.vmid}, {t.cores ?? '?'} vCPU,{' '}
                    {t.memory_mb ? `${Math.round(t.memory_mb / 1024)} GB` : '?'} RAM, node {t.node})
                  </option>
                ))}
              </select>
              {selected && (
                <p className="mt-2 text-xs text-gray-500">
                  Cluster {selected.cluster_name} · Node {selected.node} · OS-Typ {selected.ostype || 'n/a'}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  VM Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="tenant01-vm02"
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border text-gray-900"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Hostname</label>
                <input
                  type="text"
                  value={hostname}
                  onChange={(e) => setHostname(e.target.value)}
                  placeholder="vm02.lab.net"
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border text-gray-900"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700">Description</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border text-gray-900"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  CPU cores (override)
                </label>
                <input
                  type="number"
                  min={1}
                  value={cpuCores}
                  onChange={(e) => setCpuCores(e.target.value)}
                  placeholder={selected?.cores ? String(selected.cores) : 'template default'}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border text-gray-900"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Memory MB (override)
                </label>
                <input
                  type="number"
                  min={512}
                  step={512}
                  value={memoryMb}
                  onChange={(e) => setMemoryMb(e.target.value)}
                  placeholder={selected?.memory_mb ? String(selected.memory_mb) : 'template default'}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border text-gray-900"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700">
                  Target storage (Proxmox storage name)
                </label>
                <input
                  type="text"
                  value={storagePool}
                  onChange={(e) => setStoragePool(e.target.value)}
                  placeholder="fast-local or capacity-nfs (empty = same as template)"
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm px-3 py-2 border text-gray-900"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={startAfterClone}
                onChange={(e) => setStartAfterClone(e.target.checked)}
                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              Start VM after clone
            </label>

            <div className="flex justify-end gap-3 border-t border-gray-200 pt-4">
              <button
                type="button"
                onClick={() => navigate('/vms')}
                className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={cloneMutation.isPending || !selected}
                className="px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
              >
                {cloneMutation.isPending ? 'Cloning…' : 'Clone VM'}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  )
}
