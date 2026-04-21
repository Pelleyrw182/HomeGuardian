import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import smallFixesImage from './assets/value-small-fixes.svg'
import upkeepImage from './assets/value-routine-upkeep.svg'
import surpriseIssueImage from './assets/value-surprise-issues.svg'
import './App.css'

type AppUser = {
  id: string
  email: string
  role: UserRole
}

type UserRole = 'customer' | 'provider' | 'owner'

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

type IssuePhotoAnalysis = {
  id: string
  created_at: string
  photo_name: string
  summary: string
  severity: 'low' | 'medium' | 'high'
  recommended_action: string
}

type ServiceRequest = {
  id: string
  created_at: string
  homeowner_email: string
  provider_email: string | null
  service_type: string
  notes: string
  status: 'requested' | 'accepted'
  estimated_revenue: number
  accepted_at: string | null
}

const demoUserStorageKey = 'hg-demo-user'

const defaultProfile: HomeProfile = {
  home_type: '',
  build_year: '',
  household_size: '',
}

const randomId = () => {
  const browserCrypto = globalThis.crypto
  if (browserCrypto?.randomUUID) {
    return browserCrypto.randomUUID()
  }
  if (browserCrypto?.getRandomValues) {
    return `${Date.now()}-${browserCrypto.getRandomValues(new Uint32Array(1))[0].toString(16)}`
  }
  return `${Date.now()}`
}

const profileKey = (email: string) => `hg-profile-${email}`
const taskKey = (email: string) => `hg-tasks-${email}`
const photoAnalysisKey = (email: string) => `hg-photo-analyses-${email}`
const serviceRequestStorageKey = 'hg-service-requests'

const estimateServiceRevenue = (serviceType: string) => {
  const normalized = serviceType.toLowerCase()
  if (normalized.includes('plumb')) return 240
  if (normalized.includes('electr')) return 260
  if (normalized.includes('hvac')) return 300
  return 180
}

const inferSeverityFromText = (text: string): IssuePhotoAnalysis['severity'] => {
  const normalized = text.toLowerCase()
  if (
    normalized.includes('smoke') ||
    normalized.includes('fire') ||
    normalized.includes('electrical') ||
    normalized.includes('flood') ||
    normalized.includes('burst')
  ) {
    return 'high'
  }
  if (
    normalized.includes('leak') ||
    normalized.includes('crack') ||
    normalized.includes('mold') ||
    normalized.includes('rust')
  ) {
    return 'medium'
  }
  return 'low'
}

const buildDemoPhotoAnalysis = (
  fileName: string,
  notes: string,
): Omit<IssuePhotoAnalysis, 'id' | 'created_at'> => {
  const severity = inferSeverityFromText(`${fileName} ${notes}`)
  const recommendedAction =
    severity === 'high'
      ? 'Dispatch a technician within 24 hours and document immediate safety controls.'
      : severity === 'medium'
        ? 'Schedule service this week and monitor the area daily for changes.'
        : 'Add to routine maintenance and re-check during the next scheduled visit.'

  return {
    photo_name: fileName,
    summary:
      severity === 'high'
        ? 'Potential high-risk issue detected from visual context and notes.'
        : severity === 'medium'
          ? 'Issue appears moderate and should be addressed before escalation.'
          : 'Issue appears minor based on the submitted photo and notes.',
    severity,
    recommended_action: recommendedAction,
  }
}

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('Could not read uploaded image.'))
    reader.readAsDataURL(file)
  })

function App() {
  const [user, setUser] = useState<AppUser | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authRole, setAuthRole] = useState<UserRole>('customer')
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

  const [issuePhoto, setIssuePhoto] = useState<File | null>(null)
  const [issueNotes, setIssueNotes] = useState('')
  const [photoAnalysisReply, setPhotoAnalysisReply] = useState('')
  const [photoAnalysisBusy, setPhotoAnalysisBusy] = useState(false)
  const [photoAnalysisError, setPhotoAnalysisError] = useState('')
  const [photoAnalyses, setPhotoAnalyses] = useState<IssuePhotoAnalysis[]>([])
  const [serviceRequests, setServiceRequests] = useState<ServiceRequest[]>([])
  const [serviceType, setServiceType] = useState('Plumber')
  const [serviceRequestNotes, setServiceRequestNotes] = useState('')

  const [dataError, setDataError] = useState('')

  const modeLabel = isSupabaseConfigured ? 'Supabase mode' : 'Demo mode'
  const isOwner = user?.role === 'owner'
  const isProvider = user?.role === 'provider'

  useEffect(() => {
    if (!isSupabaseConfigured) {
      const saved = localStorage.getItem(demoUserStorageKey)
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as AppUser
          if (parsed?.id && parsed?.email) {
            setUser({
              id: parsed.id,
              email: parsed.email,
              role:
                parsed.role === 'owner'
                  ? 'owner'
                  : parsed.role === 'provider'
                    ? 'provider'
                    : 'customer',
            })
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
      setUser({
        id: sessionUser.id,
        email: sessionUser.email,
        role:
          sessionUser.user_metadata?.role === 'owner'
            ? 'owner'
            : sessionUser.user_metadata?.role === 'provider'
              ? 'provider'
              : 'customer',
      })
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const sessionUser = session?.user
      if (!sessionUser?.email) {
        setUser(null)
        return
      }
      setUser({
        id: sessionUser.id,
        email: sessionUser.email,
        role:
          sessionUser.user_metadata?.role === 'owner'
            ? 'owner'
            : sessionUser.user_metadata?.role === 'provider'
              ? 'provider'
              : 'customer',
      })
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    const loadUserData = async () => {
      if (!user) {
        setTasks([])
        setProfile(defaultProfile)
        setPhotoAnalyses([])
        setServiceRequests([])
        return
      }

      const savedRequests = localStorage.getItem(serviceRequestStorageKey)
      setServiceRequests(savedRequests ? (JSON.parse(savedRequests) as ServiceRequest[]) : [])

      const savedPhotoAnalyses = localStorage.getItem(photoAnalysisKey(user.email))
      setPhotoAnalyses(
        savedPhotoAnalyses ? (JSON.parse(savedPhotoAnalyses) as IssuePhotoAnalysis[]) : [],
      )

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

  const completedTaskCount = useMemo(
    () => tasks.filter((task) => task.status === 'done').length,
    [tasks],
  )

  const completionRate = useMemo(() => {
    if (tasks.length === 0) return 0
    return Math.round((completedTaskCount / tasks.length) * 100)
  }, [completedTaskCount, tasks.length])

  const urgentFindingCount = useMemo(
    () => photoAnalyses.filter((analysis) => analysis.severity === 'high').length,
    [photoAnalyses],
  )

  const combinedRequestCount = tasks.length + photoAnalyses.length

  const overdueTaskCount = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return tasks.filter((task) => {
      if (task.status === 'done' || !task.due_date) return false
      const due = new Date(task.due_date)
      due.setHours(0, 0, 0, 0)
      return due < today
    }).length
  }, [tasks])

  const recentlyCreatedDoneCount = useMemo(() => {
    const now = Date.now()
    const weekMs = 7 * 24 * 60 * 60 * 1000
    return tasks.filter((task) => task.status === 'done' && now - Date.parse(task.created_at) <= weekMs)
      .length
  }, [tasks])

  const backlogRate = useMemo(() => {
    if (tasks.length === 0) return 0
    return Math.round((openTaskCount / tasks.length) * 100)
  }, [openTaskCount, tasks.length])

  const urgentIncidentRate = useMemo(() => {
    if (combinedRequestCount === 0) return 0
    return Math.round((urgentFindingCount / combinedRequestCount) * 100)
  }, [combinedRequestCount, urgentFindingCount])

  const acceptedServiceCount = useMemo(
    () => serviceRequests.filter((request) => request.status === 'accepted').length,
    [serviceRequests],
  )

  const pendingServiceCount = useMemo(
    () => serviceRequests.filter((request) => request.status === 'requested').length,
    [serviceRequests],
  )

  const totalServiceRevenue = useMemo(
    () =>
      serviceRequests.reduce(
        (sum, request) => (request.status === 'accepted' ? sum + request.estimated_revenue : sum),
        0,
      ),
    [serviceRequests],
  )

  const averageTicketValue = useMemo(() => {
    if (acceptedServiceCount === 0) return 0
    return Math.round(totalServiceRevenue / acceptedServiceCount)
  }, [acceptedServiceCount, totalServiceRevenue])

  const homeownerRequests = useMemo(
    () => serviceRequests.filter((request) => request.homeowner_email === user?.email),
    [serviceRequests, user?.email],
  )

  const providerInboxRequests = useMemo(
    () =>
      serviceRequests.filter(
        (request) =>
          request.status === 'requested' ||
          (request.provider_email !== null && request.provider_email === user?.email),
      ),
    [serviceRequests, user?.email],
  )

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
      const demoUser: AppUser = { id: randomId(), email, role: authRole }
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

    const { data, error } = isSignUp
      ? await supabase.auth.signUp({
          email,
          password,
          options: { data: { role: authRole } },
        })
      : await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setAuthError(error.message)
    } else {
      const signedInRole =
        data.user?.user_metadata?.role === 'owner'
          ? 'owner'
          : data.user?.user_metadata?.role === 'provider'
            ? 'provider'
            : 'customer'
      if (!isSignUp && signedInRole !== authRole) {
        await supabase.auth.signOut()
        setAuthError(
          `This account is registered as ${signedInRole}. Please use the ${signedInRole} login.`,
        )
        setIsAuthBusy(false)
        return
      }
      setEmail('')
      setPassword('')
      if (isSignUp) {
        setAuthError(
          `Check your email to confirm your ${authRole} account before logging in.`,
        )
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
    const focusLine = profile.home_type
      ? `For your ${profile.home_type}, focus on the highest-impact preventive checks first.`
      : 'Start with the top three preventive checks this week.'

    const planLine =
      openTaskCount > 0
        ? `You currently have ${openTaskCount} open task(s); prioritize safety and water-related items first.`
        : 'Great job staying current—create one seasonal inspection task to keep momentum.'

    return `${focusLine}\n${planLine}\nSuggested next step: schedule a 30-minute maintenance block in the next 48 hours and complete one task end-to-end.`
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

  const analyzeIssuePhoto = async (event: FormEvent) => {
    event.preventDefault()
    if (!user || !issuePhoto) return

    if (issuePhoto.size > 5 * 1024 * 1024) {
      setPhotoAnalysisError('Please upload an image under 5MB.')
      return
    }

    setPhotoAnalysisError('')
    setPhotoAnalysisReply('')
    setPhotoAnalysisBusy(true)

    try {
      const imageData = await fileToDataUrl(issuePhoto)
      const response = await fetch('/api/home-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `Interpret this photo live and identify what the issue is and how to solve it.\nNotes: ${issueNotes || 'N/A'}\nBe concrete and safety-first.`,
          image: imageData,
          fileName: issuePhoto.name,
          tasks: tasks.slice(0, 10),
          profile,
        }),
      })

      if (!response.ok) {
        throw new Error('Photo analysis endpoint unavailable.')
      }

      const result = (await response.json()) as { response?: string }
      if (!result.response) {
        throw new Error('Photo analysis returned empty response.')
      }

      const severity = inferSeverityFromText(result.response)
      const analysis: IssuePhotoAnalysis = {
        id: randomId(),
        created_at: new Date().toISOString(),
        photo_name: issuePhoto.name,
        summary: result.response,
        severity,
        recommended_action:
          severity === 'high'
            ? 'Escalate to an urgent dispatch workflow.'
            : severity === 'medium'
              ? 'Create a near-term service appointment and monitor.'
              : 'Track in routine maintenance cadence.',
      }

      setPhotoAnalysisReply(result.response)
      setPhotoAnalyses((prev) => {
        const next = [analysis, ...prev]
        localStorage.setItem(photoAnalysisKey(user.email), JSON.stringify(next))
        return next
      })
    } catch {
      const fallback = buildDemoPhotoAnalysis(issuePhoto.name, issueNotes)
      const fallbackReply = `${fallback.summary}\nRecommended action: ${fallback.recommended_action}`
      const analysis: IssuePhotoAnalysis = {
        id: randomId(),
        created_at: new Date().toISOString(),
        ...fallback,
      }

      setPhotoAnalysisReply(fallbackReply)
      setPhotoAnalysisError(
        'Using local fallback analysis. Configure the AI function for live image interpretation.',
      )
      setPhotoAnalyses((prev) => {
        const next = [analysis, ...prev]
        localStorage.setItem(photoAnalysisKey(user.email), JSON.stringify(next))
        return next
      })
    } finally {
      setPhotoAnalysisBusy(false)
    }
  }

  const submitServiceRequest = (event: FormEvent) => {
    event.preventDefault()
    if (!user || !serviceType.trim()) return

    const nextRequest: ServiceRequest = {
      id: randomId(),
      created_at: new Date().toISOString(),
      homeowner_email: user.email,
      provider_email: null,
      service_type: serviceType.trim(),
      notes: serviceRequestNotes.trim(),
      status: 'requested',
      estimated_revenue: estimateServiceRevenue(serviceType),
      accepted_at: null,
    }

    setServiceRequests((prev) => {
      const next = [nextRequest, ...prev]
      localStorage.setItem(serviceRequestStorageKey, JSON.stringify(next))
      return next
    })
    setServiceType('Plumber')
    setServiceRequestNotes('')
  }

  const acceptServiceRequest = (requestId: string) => {
    if (!user) return
    setServiceRequests((prev) => {
      const next: ServiceRequest[] = prev.map((request) =>
        request.id === requestId
          ? {
              ...request,
              status: 'accepted' as const,
              provider_email: user.email,
              accepted_at: new Date().toISOString(),
            }
          : request,
      )
      localStorage.setItem(serviceRequestStorageKey, JSON.stringify(next))
      return next
    })
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <h1>HomeGuardian</h1>
          <p>
            Stop worrying about what might break next. We take care of the small fixes, routine
            upkeep, and surprise issues—so your home stays running smoothly without the stress or
            last-minute scrambling.
          </p>
        </div>
        <span className="mode-pill">{modeLabel}</span>
      </header>
      <section className="value-strip">
        <span>🛠️ Small fixes handled</span>
        <span>📅 Routine upkeep on schedule</span>
        <span>🚨 Fast help for surprise issues</span>
      </section>
      <section className="value-gallery" aria-label="Value proposition examples">
        <figure className="value-image-card">
          <img src={smallFixesImage} alt="A technician handling a quick home repair." />
          <figcaption>Small fixes handled</figcaption>
        </figure>
        <figure className="value-image-card">
          <img src={upkeepImage} alt="A homeowner checking routine upkeep tasks on a calendar." />
          <figcaption>Routine upkeep on schedule</figcaption>
        </figure>
        <figure className="value-image-card">
          <img src={surpriseIssueImage} alt="A burst pipe alert with rapid repair support." />
          <figcaption>Fast support for surprise issues</figcaption>
        </figure>
      </section>

      {!user ? (
        <section className="card auth-card">
          <h2>
            {isSignUp ? 'Create account' : 'Log in'} (
            {authRole === 'owner'
              ? 'Owner'
              : authRole === 'provider'
                ? 'Provider'
                : 'Homeowner'}
            )
          </h2>
          <div className="role-toggle" role="group" aria-label="Choose login type">
            <button
              type="button"
              className={authRole === 'customer' ? 'active' : ''}
              onClick={() => setAuthRole('customer')}
            >
              Homeowner login
            </button>
            <button
              type="button"
              className={authRole === 'provider' ? 'active' : ''}
              onClick={() => setAuthRole('provider')}
            >
              Provider login
            </button>
            <button
              type="button"
              className={authRole === 'owner' ? 'active' : ''}
              onClick={() => setAuthRole('owner')}
            >
              Owner login
            </button>
          </div>
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
              <p>
                {isOwner
                  ? 'Your owner dashboard is ready with firm-level operational insight.'
                  : isProvider
                    ? 'Your provider dashboard is ready with incoming service requests.'
                    : 'Your homeowner dashboard is ready for maintenance tracking.'}
              </p>
            </div>
            <button onClick={logout}>Log out</button>
          </section>

          {isOwner ? (
            <>
              <section className="stats-grid">
                <article className="card stat">
                  <h3>Total request volume</h3>
                  <p>{combinedRequestCount + serviceRequests.length}</p>
                </article>
                <article className="card stat">
                  <h3>Backlog rate</h3>
                  <p>{backlogRate}%</p>
                </article>
                <article className="card stat">
                  <h3>Completion rate</h3>
                  <p>{completionRate}%</p>
                </article>
                <article className="card stat">
                  <h3>Urgent findings</h3>
                  <p>{urgentFindingCount}</p>
                </article>
                <article className="card stat">
                  <h3>SLA risk items</h3>
                  <p>{overdueTaskCount + dueSoonCount}</p>
                </article>
                <article className="card stat">
                  <h3>Accepted jobs</h3>
                  <p>{acceptedServiceCount}</p>
                </article>
                <article className="card stat">
                  <h3>Pending dispatch</h3>
                  <p>{pendingServiceCount}</p>
                </article>
                <article className="card stat">
                  <h3>Revenue</h3>
                  <p>${totalServiceRevenue}</p>
                </article>
                <article className="card stat">
                  <h3>Avg ticket</h3>
                  <p>${averageTicketValue}</p>
                </article>
                <article className="card stat">
                  <h3>Urgent incident rate</h3>
                  <p>{urgentIncidentRate}%</p>
                </article>
                <article className="card stat">
                  <h3>Done jobs created (7d)</h3>
                  <p>{recentlyCreatedDoneCount}</p>
                </article>
                <article className="card stat">
                  <h3>Upcoming workload</h3>
                  <p>{dueSoonCount}</p>
                </article>
              </section>
              <section className="card">
                <h2>Owner operations summary</h2>
                <p>
                  Track revenue, accepted jobs, dispatch pressure, and fulfillment health to run the
                  business with clear operational visibility.
                </p>
                <ul className="analysis-list">
                  {photoAnalyses.slice(0, 5).map((analysis) => (
                    <li key={analysis.id}>
                      <strong>{analysis.photo_name}</strong>
                      <p>
                        Severity:{' '}
                        <span className={`severity-pill ${analysis.severity}`}>
                          {analysis.severity}
                        </span>
                      </p>
                      <small>{new Date(analysis.created_at).toLocaleString()}</small>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          ) : isProvider ? (
            <>
              <section className="stats-grid">
                <article className="card stat">
                  <h3>Inbox requests</h3>
                  <p>{providerInboxRequests.length}</p>
                </article>
                <article className="card stat">
                  <h3>Awaiting acceptance</h3>
                  <p>{pendingServiceCount}</p>
                </article>
                <article className="card stat">
                  <h3>Accepted jobs</h3>
                  <p>
                    {providerInboxRequests.filter((request) => request.status === 'accepted').length}
                  </p>
                </article>
              </section>
              <section className="card">
                <h2>Provider request inbox</h2>
                {providerInboxRequests.length === 0 ? (
                  <p className="empty">No service requests yet.</p>
                ) : (
                  <ul className="analysis-list">
                    {providerInboxRequests.map((request) => (
                      <li key={request.id}>
                        <strong>{request.service_type}</strong>
                        <p>Homeowner: {request.homeowner_email}</p>
                        {request.notes && <p>Notes: {request.notes}</p>}
                        <p>Status: {request.status}</p>
                        <p>Estimated ticket: ${request.estimated_revenue}</p>
                        {request.status === 'requested' && (
                          <button type="button" onClick={() => acceptServiceRequest(request.id)}>
                            Accept request
                          </button>
                        )}
                        <small>{new Date(request.created_at).toLocaleString()}</small>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          ) : (
            <>
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

                <article className="card">
                  <h2>AI live photo diagnosis</h2>
                  <form className="stack" onSubmit={analyzeIssuePhoto}>
                    <label>
                      Upload issue photo
                      <input
                        type="file"
                        accept="image/*"
                        required
                        onChange={(event) => setIssuePhoto(event.target.files?.[0] ?? null)}
                      />
                    </label>
                    <label>
                      Optional notes
                      <textarea
                        rows={3}
                        value={issueNotes}
                        onChange={(event) => setIssueNotes(event.target.value)}
                        placeholder="Example: Leak near upstairs bathroom after heavy rain."
                      />
                    </label>
                    <button disabled={photoAnalysisBusy} type="submit">
                      {photoAnalysisBusy ? 'Analyzing…' : 'Analyze photo'}
                    </button>
                  </form>
                  {photoAnalysisError && <p className="inline-error">{photoAnalysisError}</p>}
                  {photoAnalysisReply && <pre className="assistant-reply">{photoAnalysisReply}</pre>}
                  <ul className="analysis-list">
                    {photoAnalyses.slice(0, 5).map((analysis) => (
                      <li key={analysis.id}>
                        <strong>{analysis.photo_name}</strong>
                        <p>
                          Severity:{' '}
                          <span className={`severity-pill ${analysis.severity}`}>
                            {analysis.severity}
                          </span>
                        </p>
                        <small>{new Date(analysis.created_at).toLocaleString()}</small>
                      </li>
                    ))}
                  </ul>
                </article>

                <article className="card">
                  <h2>Request a provider</h2>
                  <form className="stack" onSubmit={submitServiceRequest}>
                    <label>
                      Service type
                      <input
                        required
                        value={serviceType}
                        onChange={(event) => setServiceType(event.target.value)}
                        placeholder="Plumber"
                      />
                    </label>
                    <label>
                      Issue details
                      <textarea
                        rows={3}
                        value={serviceRequestNotes}
                        onChange={(event) => setServiceRequestNotes(event.target.value)}
                        placeholder="Example: kitchen sink leaking under cabinet."
                      />
                    </label>
                    <button type="submit">Send request</button>
                  </form>
                  <ul className="analysis-list">
                    {homeownerRequests.slice(0, 8).map((request) => (
                      <li key={request.id}>
                        <strong>{request.service_type}</strong>
                        <p>Status: {request.status}</p>
                        <p>Estimated cost: ${request.estimated_revenue}</p>
                        {request.provider_email && <p>Provider: {request.provider_email}</p>}
                        <small>{new Date(request.created_at).toLocaleString()}</small>
                      </li>
                    ))}
                  </ul>
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
            </>
          )}

          {dataError && <p className="inline-error">{dataError}</p>}
        </>
      )}
    </main>
  )
}

export default App
