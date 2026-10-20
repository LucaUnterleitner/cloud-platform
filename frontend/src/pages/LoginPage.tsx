import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { authApi, organizationsApi } from '../services/api'
import { useAuthStore } from '../stores/authStore'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const { setAuth, setOrganizations } = useAuthStore()

  const loginMutation = useMutation({
    mutationFn: () => authApi.login(email, password),
    onSuccess: async (data) => {
      // Store tokens first so they're available for the next API call
      localStorage.setItem('access_token', data.access_token)
      localStorage.setItem('refresh_token', data.refresh_token)

      try {
        // Now get user info with the stored token
        const user = await authApi.getCurrentUser()
        setAuth(user, data.access_token, data.refresh_token)
      } catch (err: any) {
        console.error('Failed to load current user:', err)
        setError(
          `Login accepted, but loading the profile failed ` +
            `(HTTP ${err.response?.status ?? 'network'}).`
        )
        return
      }

      // Load organizations and set the first one as current
      try {
        const organizations = await organizationsApi.listMyOrganizations()

        if (organizations && organizations.length > 0) {
          setOrganizations(organizations)
        } else {
          console.warn('No organizations found for user')
          setError('No organizations found for this user. Please contact an administrator.')
          return
        }
      } catch (err: any) {
        console.error('Failed to load organizations:', err)
        setError(
          `Login accepted, but loading organizations failed ` +
            `(HTTP ${err.response?.status ?? 'network'}).`
        )
        return
      }

      navigate('/dashboard')
    },
    onError: (err: any) => {
      const detail = err.response?.data?.detail
      if (typeof detail === 'string') {
        setError(detail)
        return
      }
      if (Array.isArray(detail) && detail.length > 0) {
        setError(detail.map((d: any) => d.msg).join('; '))
        return
      }
      const nested = err.response?.data?.error?.message
      if (nested) {
        setError(nested)
        return
      }
      if (err.response) {
        setError(`Login failed (HTTP ${err.response.status})`)
        return
      }
      setError(
        `Server not reachable (${err.config?.baseURL || 'API'}). ` +
          'Check the URL and that the portal is running.'
      )
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    loginMutation.mutate()
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Cloud Platform
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Sign in to your account
          </p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="rounded-md bg-red-50 p-4">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}
          <div className="rounded-md shadow-sm -space-y-px">
            <div>
              <label htmlFor="email" className="sr-only">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-t-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                placeholder="Email address"
              />
            </div>
            <div>
              <label htmlFor="password" className="sr-only">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="appearance-none rounded-none relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 rounded-b-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                placeholder="Password"
              />
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={loginMutation.isPending}
              className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loginMutation.isPending ? 'Signing in...' : 'Sign in'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
