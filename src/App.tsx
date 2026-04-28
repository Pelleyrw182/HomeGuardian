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
  contractor_id?: string
  contractor_name?: string
  service_type: string
  notes: string
  status: 'requested' | 'accepted'
  estimated_revenue: number
  accepted_at: string | null
}

type PrivateContractor = {
  id: string
  name: string
  specialty: string
  rating: number
  response_time: string
  service_area: string
  starting_price: number
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

const privateContractors: PrivateContractor[] = [
  {
    id: 'blue-pipe-pros',
    name: 'Blue Pipe Pros',
    specialty: 'Plumbing repairs',
    rating: 4.8,
    response_time: 'Same day',
    service_area: 'City core + inner suburbs',
    starting_price: 165,
  },
  {
    id: 'prime-electric',
    name: 'Prime Electric Co.',
    specialty: 'Electrical troubleshooting',
    rating: 4.7,
    response_time: 'Within 24 hours',
    service_area: 'Metro-wide',
    starting_price: 185,
  },
  {
    id: 'total-comfort-hvac',
    name: 'Total Comfort HVAC',
    specialty: 'Heating & cooling',
    rating: 4.9,
    response_time: 'Priority next-day',
    service_area: 'North + west districts',
    starting_price: 210,
  },
]

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

const clampValue = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const buildTrendSeries = (
  latestValue: number,
  points = 6,
  offset = 0.5,
  minValue = 0,
) => {
  const startValue = Math.max(minValue, latestValue - offset)
  const step = points > 1 ? (latestValue - startValue) / (points - 1) : 0
  return Array.from({ length: points }, (_, index) =>
    Number((startValue + step * index).toFixed(2)),
  )
}

const buildLineChartPaths = (
  values: number[],
  width = 320,
  height = 140,
  padding = 16,
) => {
  const minValue = Math.min(...values)
  const maxValue = Math.max(...values)
  const range = maxValue - minValue || 1
  const stepX = values.length > 1 ? (width - padding * 2) / (values.length - 1) : 0
  const points = values.map((value, index) => {
    const x = padding + index * stepX
    const y = padding + (1 - (value - minValue) / range) * (height - padding * 2)
    return { x, y }
  })
  const linePath = points.map((point, index) =>
    `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`,
  ).join(' ')
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`
  const pointString = points.map((point) => `${point.x},${point.y}`).join(' ')
  return { linePath, areaPath, pointString, width, height }
}

const formatShortDate = (value: string) =>
  new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

const getInitials = (email: string | undefined) => {
  if (!email) return 'HG'
  const name = email.split('@')[0]
  const letters = name.replace(/[^a-zA-Z]/g, '')
  return (letters.slice(0, 2) || 'HG').toUpperCase()
}

const buildPieSegments = (
  counts: Record<string, number>,
  colors: string[],
) => {
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0) || 1
  let current = 0
  return Object.entries(counts).map(([label, value], index) => {
    const percent = (value / total) * 100
    const start = current
    const end = current + percent
    current = end
    return {
      label,
      value,
      percent,
      color: colors[index % colors.length],
      start,
      end,
    }
  })
}

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

  const [issuePhoto, setIssuePhoto] = useState<File | null>(null)
  const [issueNotes, setIssueNotes] = useState('')
  const [photoAnalysisReply, setPhotoAnalysisReply] = useState('')
  const [photoAnalysisBusy, setPhotoAnalysisBusy] = useState(false)
  const [photoAnalysisError, setPhotoAnalysisError] = useState('')
  const [photoAnalyses, setPhotoAnalyses] = useState<IssuePhotoAnalysis[]>([])
  const [serviceRequests, setServiceRequests] = useState<ServiceRequest[]>([])
  const [serviceType, setServiceType] = useState('Plumber')
  const [serviceRequestNotes, setServiceRequestNotes] = useState('')
  const [selectedContractorId, setSelectedContractorId] = useState(privateContractors[0].id)

  const [dataError, setDataError] = useState('')
  const [activeSection, setActiveSection] = useState('overview')
  const [dateRange, setDateRange] = useState('Last 30 days')

  const modeLabel = isSupabaseConfigured ? 'Supabase mode' : 'Demo mode'

  const adminNavItems = [
    { id: 'overview', label: 'Overview', icon: '📊' },
    { id: 'customers', label: 'Customers', icon: '👥' },
    { id: 'services', label: 'Services', icon: '🧰' },
    { id: 'schedule', label: 'Schedule', icon: '🗓️' },
    { id: 'technicians', label: 'Technicians', icon: '🧑‍🔧' },
    { id: 'billing', label: 'Billing & Finance', icon: '💳' },
    { id: 'reports', label: 'Reports', icon: '📈' },
    { id: 'alerts', label: 'Alerts', icon: '🚨' },
    { id: 'settings', label: 'Settings', icon: '⚙️' },
  ]

  const adminTitleMap = adminNavItems.reduce<Record<string, string>>((acc, item) => {
    acc[item.id] = item.label
    return acc
  }, {})

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

  const selectedContractor = useMemo(
    () => privateContractors.find((contractor) => contractor.id === selectedContractorId) ?? null,
    [selectedContractorId],
  )

  const recentRequestCount = useMemo(() => {
    const now = Date.now()
    const weekMs = 7 * 24 * 60 * 60 * 1000
    return serviceRequests.filter((request) => now - Date.parse(request.created_at) <= weekMs).length
  }, [serviceRequests])

  const customerSatisfactionScore = useMemo(() => {
    if (tasks.length === 0 && serviceRequests.length === 0 && photoAnalyses.length === 0) return 4.6
    const completionBoost = (completionRate / 100) * 0.7
    const incidentPenalty = (urgentIncidentRate / 100) * 0.4
    const score = 4.1 + completionBoost - incidentPenalty
    return Number(clampValue(score, 3.6, 4.9).toFixed(1))
  }, [tasks.length, serviceRequests.length, photoAnalyses.length, completionRate, urgentIncidentRate])

  const lowSatisfactionCount = useMemo(() => {
    if (customerSatisfactionScore >= 4.5) return 0
    if (customerSatisfactionScore >= 4.3) return 1
    if (customerSatisfactionScore >= 4.1) return 2
    return 3
  }, [customerSatisfactionScore])

  const onTimeCompletion = useMemo(() => {
    if (tasks.length === 0) return 96
    return clampValue(completionRate, 70, 100)
  }, [tasks.length, completionRate])

  const ltvCacRatio = useMemo(() => {
    if (acceptedServiceCount === 0) return 3.4
    const ratio = (averageTicketValue || 180) / 70
    return Number(clampValue(ratio, 1.8, 5).toFixed(1))
  }, [acceptedServiceCount, averageTicketValue])

  const experimentsThisMonth = useMemo(() => {
    const now = Date.now()
    const monthMs = 30 * 24 * 60 * 60 * 1000
    const recentAnalyses = photoAnalyses.filter(
      (analysis) => now - Date.parse(analysis.created_at) <= monthMs,
    ).length
    if (recentAnalyses > 0) return recentAnalyses
    if (serviceRequests.length > 0) return Math.max(1, Math.round(serviceRequests.length / 2))
    return 3
  }, [photoAnalyses, serviceRequests.length])

  const satisfactionTrend = useMemo(() => {
    const baseline = 4.1
    const diff = customerSatisfactionScore - baseline
    const percent = baseline ? Math.abs((diff / baseline) * 100) : 0
    return { label: `${diff >= 0 ? '▲' : '▼'} ${percent.toFixed(1)}%`, positive: diff >= 0 }
  }, [customerSatisfactionScore])

  const onTimeTrend = useMemo(() => {
    const baseline = 90
    const diff = onTimeCompletion - baseline
    const percent = baseline ? Math.abs((diff / baseline) * 100) : 0
    return { label: `${diff >= 0 ? '▲' : '▼'} ${percent.toFixed(1)}%`, positive: diff >= 0 }
  }, [onTimeCompletion])

  const ltvTrend = useMemo(() => {
    const baseline = 2.8
    const diff = ltvCacRatio - baseline
    const percent = baseline ? Math.abs((diff / baseline) * 100) : 0
    return { label: `${diff >= 0 ? '▲' : '▼'} ${percent.toFixed(1)}%`, positive: diff >= 0 }
  }, [ltvCacRatio])

  const satisfactionSeries = useMemo(
    () => buildTrendSeries(customerSatisfactionScore, 6, 0.5, 3.8),
    [customerSatisfactionScore],
  )

  const onTimeSeries = useMemo(
    () => buildTrendSeries(onTimeCompletion, 6, 6, 85),
    [onTimeCompletion],
  )

  const satisfactionChart = useMemo(
    () => buildLineChartPaths(satisfactionSeries),
    [satisfactionSeries],
  )

  const onTimeChart = useMemo(() => buildLineChartPaths(onTimeSeries), [onTimeSeries])

  const serviceCategoryCounts = useMemo(() => {
    const counts = {
      HVAC: 0,
      Plumbing: 0,
      Electrical: 0,
      'General Repairs': 0,
    }
    serviceRequests.forEach((request) => {
      const normalized = request.service_type.toLowerCase()
      if (normalized.includes('hvac') || normalized.includes('heating')) {
        counts.HVAC += 1
      } else if (normalized.includes('plumb')) {
        counts.Plumbing += 1
      } else if (normalized.includes('electr')) {
        counts.Electrical += 1
      } else {
        counts['General Repairs'] += 1
      }
    })
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0)
    return total === 0
      ? { HVAC: 3, Plumbing: 2, Electrical: 2, 'General Repairs': 1 }
      : counts
  }, [serviceRequests])

  const pieSegments = useMemo(
    () =>
      buildPieSegments(serviceCategoryCounts, ['#16a34a', '#1d4ed8', '#f59e0b', '#94a3b8']),
    [serviceCategoryCounts],
  )

  const pieStyle = useMemo(
    () => ({
      background: `conic-gradient(${pieSegments
        .map((segment) => `${segment.color} ${segment.start}% ${segment.end}%`)
        .join(', ')})`,
    }),
    [pieSegments],
  )

  const recentAlerts = useMemo(() => {
    const alerts: string[] = []
    if (overdueTaskCount > 0) {
      alerts.push(overdueTaskCount === 1 ? 'Job past due' : `${overdueTaskCount} jobs past due`)
    }
    if (lowSatisfactionCount > 0) {
      alerts.push(
        lowSatisfactionCount === 1
          ? 'Low customer satisfaction in one area'
          : `Low customer satisfaction in ${lowSatisfactionCount} areas`,
      )
    }
    if (recentRequestCount > 3) {
      alerts.push('Increased demand forecast')
    }
    if (pendingServiceCount > 0) {
      alerts.push(`${pendingServiceCount} requests awaiting dispatch`)
    }
    if (alerts.length === 0) {
      return ['Jobs past due', 'Low customer satisfaction in one area', 'Increased demand forecast']
    }
    return alerts.slice(0, 3)
  }, [overdueTaskCount, lowSatisfactionCount, pendingServiceCount, recentRequestCount])

  const upcomingJobs = useMemo(() => {
    const timeSlots = ['9:00 AM', '11:30 AM', '2:00 PM', '4:15 PM']
    const scheduledTasks = tasks
      .filter((task) => task.due_date)
      .sort((a, b) => Date.parse(a.due_date) - Date.parse(b.due_date))
      .slice(0, 3)
      .map((task, index) => ({
        title: task.title,
        time: `${formatShortDate(task.due_date)} · ${timeSlots[index % timeSlots.length]}`,
      }))

    if (scheduledTasks.length >= 3) return scheduledTasks

    const scheduledRequests = serviceRequests
      .slice(0, 3 - scheduledTasks.length)
      .map((request, index) => ({
        title: `${request.service_type} visit`,
        time: `${formatShortDate(request.created_at)} · ${timeSlots[index % timeSlots.length]}`,
      }))

    const fallback = [
      { title: 'Seasonal HVAC tune-up', time: 'Tue · 9:00 AM' },
      { title: 'Exterior inspection', time: 'Wed · 1:30 PM' },
      { title: 'Plumbing system check', time: 'Fri · 10:00 AM' },
    ]

    return [...scheduledTasks, ...scheduledRequests].length > 0
      ? [...scheduledTasks, ...scheduledRequests]
      : fallback
  }, [tasks, serviceRequests])

  const customerSummary = useMemo(() => {
    const counts = new Map<string, number>()
    serviceRequests.forEach((request) => {
      counts.set(request.homeowner_email, (counts.get(request.homeowner_email) ?? 0) + 1)
    })
    const sorted = Array.from(counts.entries())
      .map(([email, count]) => ({ email, count }))
      .sort((a, b) => b.count - a.count)
    return sorted.length > 0 ? sorted.slice(0, 6) : []
  }, [serviceRequests])

  const technicianSummary = useMemo(() => {
    const assignments = serviceRequests.filter((request) => request.provider_email)
    return assignments.slice(0, 6).map((request) => ({
      name: request.provider_email ?? 'Assigned tech',
      task: request.service_type,
      status: request.status,
    }))
  }, [serviceRequests])

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
    setActiveSection('overview')
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
    if (!user || !serviceType.trim() || !selectedContractor) return

    const nextRequest: ServiceRequest = {
      id: randomId(),
      created_at: new Date().toISOString(),
      homeowner_email: user.email,
      provider_email: null,
      contractor_id: selectedContractor.id,
      contractor_name: selectedContractor.name,
      service_type: serviceType.trim(),
      notes: serviceRequestNotes.trim(),
      status: 'requested',
      estimated_revenue: Math.max(
        estimateServiceRevenue(serviceType),
        selectedContractor.starting_price,
      ),
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

  const pageTitle = adminTitleMap[activeSection] ?? 'Overview'
  const profileInitials = getInitials(user?.email)

  return (
    <main className={user ? 'app-shell layout-sidebar' : 'app-shell layout-centered'}>
      {!user ? (
        <>
          <header className="pre-login-header">
            <div>
              <div className="pre-login-logo">
                <div className="logo-icon">🛡</div>
                <h1>HomeGuard</h1>
              </div>
              <p>
                Stop worrying about what might break next. We take care of the small fixes, routine
                upkeep, and surprise issues—so your home stays running smoothly.
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
          <section className="card auth-card">
            <h2>
              {isSignUp ? 'Create account' : 'Log in'} (
              {authRole === 'owner' ? 'Owner' : authRole === 'provider' ? 'Provider' : 'Homeowner'})
            </h2>
            <div className="role-toggle" role="group" aria-label="Choose login type">
              <button
                type="button"
                className={authRole === 'customer' ? 'active' : ''}
                onClick={() => setAuthRole('customer')}
              >
                Homeowner
              </button>
              <button
                type="button"
                className={authRole === 'provider' ? 'active' : ''}
                onClick={() => setAuthRole('provider')}
              >
                Provider
              </button>
              <button
                type="button"
                className={authRole === 'owner' ? 'active' : ''}
                onClick={() => setAuthRole('owner')}
              >
                Owner
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
        </>
      ) : (
        <>
          <nav className="sidebar">
            <div className="sidebar-brand">
              <div className="sidebar-logo">
                <div className="sidebar-logo-icon">HG</div>
                <span>HomeGuard</span>
              </div>
              <p>Home maintenance admin</p>
            </div>
            <div className="sidebar-nav">
              {adminNavItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`nav-item ${activeSection === item.id ? 'active' : ''}`}
                  onClick={() => setActiveSection(item.id)}
                >
                  <span className="nav-icon">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>
            <div className="sidebar-footer">
              <span className="mode-pill">{modeLabel}</span>
              <button type="button" className="btn-secondary" onClick={logout}>
                Log out
              </button>
            </div>
          </nav>

          <div className="main-panel">
            <header className="main-header">
              <div>
                <h2>{pageTitle}</h2>
                <p>HomeGuard Admin Dashboard</p>
              </div>
              <div className="header-actions">
                <select
                  aria-label="Date range"
                  className="range-select"
                  value={dateRange}
                  onChange={(event) => setDateRange(event.target.value)}
                >
                  <option>Last 7 days</option>
                  <option>Last 30 days</option>
                  <option>Last 90 days</option>
                </select>
                <div className="profile-pill" aria-label="Admin profile">
                  <span>{profileInitials}</span>
                </div>
              </div>
            </header>
            <div className="main-content">
              {activeSection === 'overview' && (
                <>
                  <section className="kpi-grid">
                    <article className="card kpi-card">
                      <div className="kpi-header">
                        <span className="kpi-icon">⭐</span>
                        <p>Customer Satisfaction</p>
                      </div>
                      <div className="kpi-value">
                        <h3>{customerSatisfactionScore} / 5</h3>
                        <span
                          className={`kpi-trend ${satisfactionTrend.positive ? 'positive' : 'negative'}`}
                        >
                          {satisfactionTrend.label}
                        </span>
                      </div>
                    </article>
                    <article className="card kpi-card">
                      <div className="kpi-header">
                        <span className="kpi-icon">⏱️</span>
                        <p>On-Time Service Completion</p>
                      </div>
                      <div className="kpi-value">
                        <h3>{onTimeCompletion}%</h3>
                        <span
                          className={`kpi-trend ${onTimeTrend.positive ? 'positive' : 'negative'}`}
                        >
                          {onTimeTrend.label}
                        </span>
                      </div>
                    </article>
                    <article className="card kpi-card">
                      <div className="kpi-header">
                        <span className="kpi-icon">💲</span>
                        <p>LTV : CAC Ratio</p>
                      </div>
                      <div className="kpi-value">
                        <h3>{ltvCacRatio} : 1</h3>
                        <span
                          className={`kpi-trend ${ltvTrend.positive ? 'positive' : 'negative'}`}
                        >
                          {ltvTrend.label}
                        </span>
                      </div>
                    </article>
                    <article className="card kpi-card">
                      <div className="kpi-header">
                        <span className="kpi-icon">💡</span>
                        <p>Service Experiments This Month</p>
                      </div>
                      <div className="kpi-value">
                        <h3>{experimentsThisMonth}</h3>
                        <span className="kpi-subtext">Active pilots</span>
                      </div>
                    </article>
                  </section>

                  <section className="chart-grid">
                    <article className="card chart-card">
                      <div className="chart-header">
                        <div>
                          <h3>Customer Satisfaction Over Time</h3>
                          <p>Last 6 months</p>
                        </div>
                        <span className="chart-badge">{customerSatisfactionScore} / 5</span>
                      </div>
                      <div className="chart-body">
                        <svg
                          viewBox={`0 0 ${satisfactionChart.width} ${satisfactionChart.height}`}
                          className="line-chart"
                          role="img"
                          aria-label="Customer satisfaction trend"
                        >
                          <defs>
                            <linearGradient id="satisfactionGradient" x1="0" x2="0" y1="0" y2="1">
                              <stop offset="0%" stopColor="#16a34a" stopOpacity="0.25" />
                              <stop offset="100%" stopColor="#16a34a" stopOpacity="0.02" />
                            </linearGradient>
                          </defs>
                          <path className="chart-area" d={satisfactionChart.areaPath} />
                          <path className="chart-line" d={satisfactionChart.linePath} />
                        </svg>
                      </div>
                    </article>
                    <article className="card chart-card">
                      <div className="chart-header">
                        <div>
                          <h3>On-Time Service Completion Over Time</h3>
                          <p>Last 6 months</p>
                        </div>
                        <span className="chart-badge">{onTimeCompletion}%</span>
                      </div>
                      <div className="chart-body">
                        <svg
                          viewBox={`0 0 ${onTimeChart.width} ${onTimeChart.height}`}
                          className="line-chart"
                          role="img"
                          aria-label="On-time completion trend"
                        >
                          <defs>
                            <linearGradient id="onTimeGradient" x1="0" x2="0" y1="0" y2="1">
                              <stop offset="0%" stopColor="#1d4ed8" stopOpacity="0.25" />
                              <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0.02" />
                            </linearGradient>
                          </defs>
                          <path className="chart-area alt" d={onTimeChart.areaPath} />
                          <path className="chart-line alt" d={onTimeChart.linePath} />
                        </svg>
                      </div>
                    </article>
                  </section>

                  <section className="lower-grid">
                    <article className="card">
                      <div className="section-header">
                        <h3>Recent Alerts</h3>
                        <span className="section-tag">Live</span>
                      </div>
                      <ul className="simple-list">
                        {recentAlerts.map((alert) => (
                          <li key={alert}>
                            <span className="list-dot" />
                            <span>{alert}</span>
                          </li>
                        ))}
                      </ul>
                    </article>
                    <article className="card">
                      <div className="section-header">
                        <h3>Upcoming Jobs</h3>
                        <span className="section-tag">Next 7 days</span>
                      </div>
                      <ul className="simple-list">
                        {upcomingJobs.map((job) => (
                          <li key={`${job.title}-${job.time}`}>
                            <div>
                              <strong>{job.title}</strong>
                              <span className="list-meta">{job.time}</span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </article>
                    <article className="card">
                      <div className="section-header">
                        <h3>Top Service Categories</h3>
                        <span className="section-tag">Share</span>
                      </div>
                      <div className="pie-wrapper">
                        <div className="pie-chart" style={pieStyle} />
                        <ul className="legend-list">
                          {pieSegments.map((segment) => (
                            <li key={segment.label}>
                              <span
                                className="legend-swatch"
                                style={{ backgroundColor: segment.color }}
                              />
                              <span>{segment.label}</span>
                              <span className="legend-value">{segment.value}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </article>
                  </section>
                </>
              )}

              {activeSection === 'customers' && (
                <section className="card">
                  <div className="section-header">
                    <div>
                      <h3>Customer Overview</h3>
                      <p className="section-subtitle">Most active households this quarter.</p>
                    </div>
                    <span className="section-tag">Active</span>
                  </div>
                  {customerSummary.length === 0 ? (
                    <p className="empty">No customer requests yet.</p>
                  ) : (
                    <ul className="summary-list">
                      {customerSummary.map((customer) => (
                        <li key={customer.email}>
                          <div>
                            <strong>{customer.email}</strong>
                            <span className="list-meta">Requests: {customer.count}</span>
                          </div>
                          <span className="status-pill">Active</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}

              {activeSection === 'services' && (
                <section className="card">
                  <div className="section-header">
                    <h3>Service Requests</h3>
                    <span className="section-tag">Dispatch</span>
                  </div>
                  <form className="stack" onSubmit={submitServiceRequest}>
                    <label>
                      Choose contractor
                      <select
                        value={selectedContractorId}
                        onChange={(event) => setSelectedContractorId(event.target.value)}
                      >
                        {privateContractors.map((contractor) => (
                          <option key={contractor.id} value={contractor.id}>
                            {contractor.name} · {contractor.specialty}
                          </option>
                        ))}
                      </select>
                    </label>
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
                  {serviceRequests.length === 0 ? (
                    <p className="empty">No service requests yet.</p>
                  ) : (
                    <ul className="summary-list">
                      {serviceRequests.slice(0, 6).map((request) => (
                        <li key={request.id}>
                          <div>
                            <strong>{request.service_type}</strong>
                            <span className="list-meta">
                              {request.contractor_name ?? 'Contractor TBD'} · {request.status}
                            </span>
                          </div>
                          <span className="status-pill">${request.estimated_revenue}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}

              {activeSection === 'schedule' && (
                <section className="card">
                  <div className="section-header">
                    <h3>Maintenance Schedule</h3>
                    <span className="section-tag">Operations</span>
                  </div>
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
              )}

              {activeSection === 'technicians' && (
                <section className="card">
                  <div className="section-header">
                    <h3>Technician Assignments</h3>
                    <span className="section-tag">Field team</span>
                  </div>
                  {technicianSummary.length === 0 ? (
                    <p className="empty">No technician assignments yet.</p>
                  ) : (
                    <ul className="summary-list">
                      {technicianSummary.map((assignment) => (
                        <li key={`${assignment.name}-${assignment.task}`}>
                          <div>
                            <strong>{assignment.name}</strong>
                            <span className="list-meta">{assignment.task}</span>
                          </div>
                          <span className="status-pill">{assignment.status}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}

              {activeSection === 'billing' && (
                <section className="card">
                  <div className="section-header">
                    <h3>Billing & Finance</h3>
                    <span className="section-tag">Summary</span>
                  </div>
                  <div className="billing-grid">
                    <div>
                      <p>Total revenue</p>
                      <h4>${totalServiceRevenue}</h4>
                    </div>
                    <div>
                      <p>Average ticket value</p>
                      <h4>${averageTicketValue}</h4>
                    </div>
                    <div>
                      <p>Accepted jobs</p>
                      <h4>{acceptedServiceCount}</h4>
                    </div>
                    <div>
                      <p>Pending dispatch</p>
                      <h4>{pendingServiceCount}</h4>
                    </div>
                  </div>
                </section>
              )}

              {activeSection === 'reports' && (
                <section className="card">
                  <div className="section-header">
                    <h3>Inspection Reports</h3>
                    <span className="section-tag">Insights</span>
                  </div>
                  {photoAnalyses.length === 0 ? (
                    <p className="empty">No inspection reports yet.</p>
                  ) : (
                    <ul className="analysis-list">
                      {photoAnalyses.slice(0, 6).map((analysis) => (
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
                  )}
                </section>
              )}

              {activeSection === 'alerts' && (
                <section className="card">
                  <div className="section-header">
                    <h3>Alerts & AI Diagnostics</h3>
                    <span className="section-tag">Live</span>
                  </div>
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
                </section>
              )}

              {activeSection === 'settings' && (
                <section className="card">
                  <div className="section-header">
                    <h3>Settings</h3>
                    <span className="section-tag">Profile</span>
                  </div>
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
                          setProfile((prev) => ({
                            ...prev,
                            household_size: event.target.value,
                          }))
                        }
                        placeholder="4"
                      />
                    </label>
                    <button type="submit">Save profile</button>
                  </form>
                </section>
              )}

              {dataError && <p className="inline-error">{dataError}</p>}
            </div>
          </div>
        </>
      )}
    </main>
  )
}

export default App
