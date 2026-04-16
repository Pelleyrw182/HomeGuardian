import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import './App.css'

type AppUser = {
  id: string
  email: string
}

type MaintenanceTask = {
  id: string
  title: string
  details: string
  due_date: string
  status: 'open' | 'done'
  created_at: string
}

type HomeProfile = {
  home_type: string
  build_year: string
  household_size: string
}

const demoUserStorageKey = 'hg-demo-user'

const defaultProfile: HomeProfile = {
  home_type: '',
  build_year: '',
  household_size: '',
}

const randomId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`

const profileKey = (email: string) => `hg-profile-${email}`
const taskKey = (email: string) => `hg-tasks-${email}`

function App() {
  const [user, setUser] = useState<AppUser | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [authError, setAuthError] = useState('')
  const [isAuthBusy, setIsAuthBusy] = useState(false)

  const [profile, setProfile] = useState<HomeProfile>(defaultProfile)
  const [tasks, setTasks] = useState<MaintenanceTask[]>([])
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDetails, setTaskDetails] = useState('')
  const [taskDueDate, setTaskDueDate] = useState('')

  const [assistantPrompt, setAssistantPrompt] = useState('')
  const [assistantReply, setAssistantReply] = useState('')
  const [assistantBusy, setAssistantBusy] = useState(false)
  const [assistantError, setAssistantError] = useState('')

  const [dataError, setDataError] = useState('')

  const modeLabel = isSupabaseConfigured ? 'Supabase mode' : 'Demo mode'

  useEffect(() => {
    if (!isSupabaseConfigured) {
      const saved = localStorage.getItem(demoUserStorageKey)
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as AppUser
          if (parsed?.id && parsed?.email) {
            setUser(parsed)
          }
        } catch {
          localStorage.removeItem(demoUserStorageKey)
        }
      }
      return
    }

    if (!supabase) {
      return
    }

    supabase.auth.getSession().then(({ data }) => {
      const sessionUser = data.session?.user
      if (!sessionUser?.email) return
      setUser({ id: sessionUser.id, email: sessionUser.email })
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const sessionUser = session?.user
      if (!sessionUser?.email) {
        setUser(null)
        return
      }
      setUser({ id: sessionUser.id, email: sessionUser.email })
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    const loadUserData = async () => {
      if (!user) {
        setTasks([])
        setProfile(defaultProfile)
        return
      }

      if (!isSupabaseConfigured) {
        const savedProfile = localStorage.getItem(profileKey(user.email))
        const savedTasks = localStorage.getItem(taskKey(user.email))
        setProfile(savedProfile ? (JSON.parse(savedProfile) as HomeProfile) : defaultProfile)
        setTasks(savedTasks ? (JSON.parse(savedTasks) as MaintenanceTask[]) : [])
        return
      }

      if (!supabase) return

      setDataError('')

      const [{ data: profileRow, error: profileError }, { data: taskRows, error: taskError }] = await Promise.all([
        supabase
          .from('home_profiles')
          .select('home_type, build_year, household_size')
          .eq('user_id', user.id)
          .maybeSingle(),
        supabase
          .from('maintenance_tasks')
          .select('id, title, details, due_date, status, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),
      ])

      if (profileError || taskError) {
        setDataError('Could not load dashboard data. Confirm your Supabase tables are set up.')
        return
      }

      setProfile(
        profileRow
          ? {
              home_type: profileRow.home_type ?? '',
              build_year: profileRow.build_year ? String(profileRow.build_year) : '',
              household_size: profileRow.household_size
                ? String(profileRow.household_size)
                : '',
            }
          : defaultProfile,
      )

      setTasks(
        (taskRows ?? []).map((task) => ({
          id: task.id,
          title: task.title,
          details: task.details ?? '',
          due_date: task.due_date ?? '',
          status: task.status === 'done' ? 'done' : 'open',
          created_at: task.created_at,
        })),
      )
    }

    loadUserData()
  }, [user])

  const openTaskCount = useMemo(
    () => tasks.filter((task) => task.status === 'open').length,
    [tasks],
  )

  const dueSoonCount = useMemo(() => {
    const now = new Date()
    const in7Days = new Date()
    in7Days.setDate(now.getDate() + 7)

    return tasks.filter((task) => {
      if (!task.due_date || task.status === 'done') return false
      const dueDate = new Date(task.due_date)
      return dueDate >= now && dueDate <= in7Days
    }).length
  }, [tasks])

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault()
    if (!user) return

    if (!isSupabaseConfigured) {
      localStorage.setItem(profileKey(user.email), JSON.stringify(profile))
      return
    }

    if (!supabase) return

    const { error } = await supabase.from('home_profiles').upsert(
      {
        user_id: user.id,
        home_type: profile.home_type,
        build_year: profile.build_year ? Number(profile.build_year) : null,
        household_size: profile.household_size ? Number(profile.household_size) : null,
      },
      { onConflict: 'user_id' },
    )

    if (error) {
      setDataError('Could not save home profile.')
    }
  }

  const handleAuth = async (event: FormEvent) => {
    event.preventDefault()
    setAuthError('')
    setIsAuthBusy(true)

    if (!isSupabaseConfigured) {
      const demoUser: AppUser = { id: randomId(), email }
      localStorage.setItem(demoUserStorageKey, JSON.stringify(demoUser))
      setUser(demoUser)
      setEmail('')
      setPassword('')
      setIsAuthBusy(false)
      return
    }

    if (!supabase) {
      setAuthError('Supabase is not configured.')
      setIsAuthBusy(false)
      return
    }

    const { error } = isSignUp
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setAuthError(error.message)
    } else {
      setEmail('')
      setPassword('')
      if (isSignUp) {
        setAuthError('Check your email to confirm your account before logging in.')
      }
    }

    setIsAuthBusy(false)
  }

  const logout = async () => {
    setAssistantReply('')

    if (!isSupabaseConfigured) {
      localStorage.removeItem(demoUserStorageKey)
      setUser(null)
      return
    }

    if (!supabase) return

    await supabase.auth.signOut()
    setUser(null)
  }

  const addTask = async (event: FormEvent) => {
    event.preventDefault()
    if (!user || !taskTitle.trim()) return

    if (!isSupabaseConfigured) {
      const demoTask: MaintenanceTask = {
        id: randomId(),
        title: taskTitle.trim(),
        details: taskDetails.trim(),
        due_date: taskDueDate,
        status: 'open',
        created_at: new Date().toISOString(),
      }
      const next = [demoTask, ...tasks]
      setTasks(next)
      localStorage.setItem(taskKey(user.email), JSON.stringify(next))
      setTaskTitle('')
      setTaskDetails('')
      setTaskDueDate('')
      return
    }

    if (!supabase) return

    const { data, error } = await supabase
      .from('maintenance_tasks')
      .insert({
        user_id: user.id,
        title: taskTitle.trim(),
        details: taskDetails.trim(),
        due_date: taskDueDate || null,
        status: 'open',
      })
      .select('id, title, details, due_date, status, created_at')
      .single()

    if (error || !data) {
      setDataError('Could not create task.')
      return
    }

    const nextTask: MaintenanceTask = {
      id: data.id,
      title: data.title,
      details: data.details ?? '',
      due_date: data.due_date ?? '',
      status: data.status === 'done' ? 'done' : 'open',
      created_at: data.created_at,
    }

    setTasks((prev) => [nextTask, ...prev])
    setTaskTitle('')
    setTaskDetails('')
    setTaskDueDate('')
  }

  const toggleTaskStatus = async (task: MaintenanceTask) => {
    if (!user) return
    const nextStatus = task.status === 'open' ? 'done' : 'open'

    if (!isSupabaseConfigured) {
      const next: MaintenanceTask[] = tasks.map((item) =>
        item.id === task.id ? { ...item, status: nextStatus } : item,
      )
      setTasks(next)
      localStorage.setItem(taskKey(user.email), JSON.stringify(next))
      return
    }

    if (!supabase) return

    const { error } = await supabase
      .from('maintenance_tasks')
      .update({ status: nextStatus })
      .eq('id', task.id)
      .eq('user_id', user.id)

    if (error) {
      setDataError('Could not update task status.')
      return
    }

    setTasks((prev) =>
      prev.map((item) => (item.id === task.id ? { ...item, status: nextStatus } : item)),
    )
  }

  const deleteTask = async (task: MaintenanceTask) => {
    if (!user) return

    if (!isSupabaseConfigured) {
      const next = tasks.filter((item) => item.id !== task.id)
      setTasks(next)
      localStorage.setItem(taskKey(user.email), JSON.stringify(next))
      return
    }

    if (!supabase) return

    const { error } = await supabase
      .from('maintenance_tasks')
      .delete()
      .eq('id', task.id)
      .eq('user_id', user.id)

    if (error) {
      setDataError('Could not delete task.')
      return
    }

    setTasks((prev) => prev.filter((item) => item.id !== task.id))
  }

  const getDemoAssistantReply = () => {
    const homeLine = profile.home_type
      ? `For your ${profile.home_type}, focus on the highest-impact preventive checks first.`
      : 'Start with the top three preventive checks this week.'

    const backlogLine =
      openTaskCount > 0
        ? `You currently have ${openTaskCount} open task(s); prioritize any safety and water-related items first.`
        : 'Great job staying current—create one seasonal inspection task to keep momentum.'

    return `${homeLine}\n${backlogLine}\nSuggested next step: schedule a 30-minute maintenance block for the next 48 hours and complete one task end-to-end.`
  }

  const askAssistant = async (event: FormEvent) => {
    event.preventDefault()
    setAssistantError('')
    setAssistantReply('')
    setAssistantBusy(true)

    try {
      const response = await fetch('/api/home-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: assistantPrompt,
          profile,
          tasks: tasks.slice(0, 10),
        }),
      })

      if (!response.ok) {
        throw new Error('Assistant endpoint not available.')
      }

      const result = (await response.json()) as { response?: string }

      if (!result.response) {
        throw new Error('Assistant returned an empty response.')
      }

      setAssistantReply(result.response)
    } catch {
      setAssistantReply(getDemoAssistantReply())
      setAssistantError(
        'Using local fallback advice. Configure OpenRouter + Netlify function for live AI guidance.',
      )
    } finally {
      setAssistantBusy(false)
    }
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <h1>HomeGuardian</h1>
          <p>
            Home maintenance without stress: track tasks, store your home profile, and get
            actionable guidance before issues become emergencies.
          </p>
        </div>
        <span className="mode-pill">{modeLabel}</span>
      </header>

      {!user ? (
        <section className="card auth-card">
          <h2>{isSignUp ? 'Create account' : 'Log in'}</h2>
          <form onSubmit={handleAuth} className="stack">
            <label>
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <button disabled={isAuthBusy} type="submit">
              {isAuthBusy ? 'Working…' : isSignUp ? 'Create account' : 'Log in'}
            </button>
          </form>
          <button className="link-button" onClick={() => setIsSignUp((prev) => !prev)}>
            {isSignUp ? 'Already have an account? Log in' : 'Need an account? Sign up'}
          </button>
          {authError && <p className="inline-error">{authError}</p>}
        </section>
      ) : (
        <>
          <section className="dashboard-head card">
            <div>
              <h2>Welcome, {user.email}</h2>
              <p>Your maintenance dashboard is ready.</p>
            </div>
            <button onClick={logout}>Log out</button>
          </section>

          <section className="stats-grid">
            <article className="card stat">
              <h3>Open tasks</h3>
              <p>{openTaskCount}</p>
            </article>
            <article className="card stat">
              <h3>Due in 7 days</h3>
              <p>{dueSoonCount}</p>
            </article>
            <article className="card stat">
              <h3>Total tasks</h3>
              <p>{tasks.length}</p>
            </article>
          </section>

          <section className="grid-two">
            <article className="card">
              <h2>Home profile</h2>
              <form onSubmit={saveProfile} className="stack">
                <label>
                  Home type
                  <input
                    value={profile.home_type}
                    onChange={(event) =>
                      setProfile((prev) => ({ ...prev, home_type: event.target.value }))
                    }
                    placeholder="Single-family, condo, townhouse..."
                  />
                </label>
                <label>
                  Build year
                  <input
                    type="number"
                    value={profile.build_year}
                    onChange={(event) =>
                      setProfile((prev) => ({ ...prev, build_year: event.target.value }))
                    }
                    placeholder="1998"
                  />
                </label>
                <label>
                  Household size
                  <input
                    type="number"
                    value={profile.household_size}
                    onChange={(event) =>
                      setProfile((prev) => ({ ...prev, household_size: event.target.value }))
                    }
                    placeholder="4"
                  />
                </label>
                <button type="submit">Save profile</button>
              </form>
            </article>

            <article className="card">
              <h2>AI maintenance assistant</h2>
              <form className="stack" onSubmit={askAssistant}>
                <label>
                  Ask about a concern or upcoming season
                  <textarea
                    required
                    rows={4}
                    value={assistantPrompt}
                    onChange={(event) => setAssistantPrompt(event.target.value)}
                    placeholder="Example: What should I check before summer heat starts?"
                  />
                </label>
                <button disabled={assistantBusy} type="submit">
                  {assistantBusy ? 'Generating…' : 'Get guidance'}
                </button>
              </form>
              {assistantError && <p className="inline-error">{assistantError}</p>}
              {assistantReply && <pre className="assistant-reply">{assistantReply}</pre>}
            </article>
          </section>

          <section className="card">
            <h2>Maintenance tasks</h2>
            <form onSubmit={addTask} className="task-form">
              <input
                required
                value={taskTitle}
                onChange={(event) => setTaskTitle(event.target.value)}
                placeholder="Task title"
              />
              <input
                value={taskDetails}
                onChange={(event) => setTaskDetails(event.target.value)}
                placeholder="Details"
              />
              <input
                type="date"
                value={taskDueDate}
                onChange={(event) => setTaskDueDate(event.target.value)}
              />
              <button type="submit">Add task</button>
            </form>

            {tasks.length === 0 ? (
              <p className="empty">No tasks yet. Add your first maintenance action.</p>
            ) : (
              <ul className="task-list">
                {tasks.map((task) => (
                  <li key={task.id} className={task.status === 'done' ? 'done' : ''}>
                    <div>
                      <strong>{task.title}</strong>
                      {task.details && <p>{task.details}</p>}
                      {task.due_date && <small>Due: {task.due_date}</small>}
                    </div>
                    <div className="task-actions">
                      <button onClick={() => toggleTaskStatus(task)} type="button">
                        {task.status === 'open' ? 'Mark done' : 'Reopen'}
                      </button>
                      <button onClick={() => deleteTask(task)} type="button">
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {dataError && <p className="inline-error">{dataError}</p>}
        </>
      )}
    </main>
  )
}

export default App
