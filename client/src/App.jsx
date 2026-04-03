import { useState, useEffect } from 'react'
import LoginPage from './pages/LoginPage.jsx'
import AppPage from './pages/AppPage.jsx'

export default function App() {
  const [page, setPage] = useState('loading')

  useEffect(() => {
    const path = window.location.pathname
    if (path === '/app') {
      setPage('app')
    } else {
      setPage('login')
    }
  }, [])

  if (page === 'loading') return null
  if (page === 'app') return <AppPage />
  return <LoginPage />
}