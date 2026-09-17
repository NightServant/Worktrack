import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { jobService } from '@/services/jobService'
import { Job, JobFormData, JobStatus } from '@/types'
import { useAuth } from '@/contexts/AuthContext'

/**
 * Hook to fetch all jobs
 */
export function useJobs() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['jobs', user?.id],
    queryFn: jobService.getJobs,
    enabled: !!user,
    staleTime: 30_000,
    gcTime: 15 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: 1,
  })
}

/**
 * Hook to fetch a single job
 */
export function useJob(id: string) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['jobs', user?.id, id],
    queryFn: () => jobService.getJob(id),
    enabled: !!id && !!user,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })
}

/**
 * Hook to fetch status history for a job
 */
export function useJobStatusHistory(jobId?: string) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['job-status-history', user?.id, jobId],
    queryFn: () => jobService.getJobStatusHistory(jobId!),
    enabled: !!jobId && !!user,
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })
}

/**
 * Hook to fetch status history across all jobs
 */
export function useAllJobStatusHistory() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['job-status-history', user?.id],
    queryFn: jobService.getAllJobStatusHistory,
    enabled: !!user,
    staleTime: 60_000,
    gcTime: 15 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  })
}

/**
 * Hook to create a new job
 */
export function useCreateJob() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: (data: JobFormData) => jobService.createJob(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs', user?.id] })
    },
  })
}

/**
 * Hook to create multiple jobs (bulk import)
 */
export function useCreateJobsBulk() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: (datas: JobFormData[]) => jobService.createJobsBulk(datas),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs', user?.id] })
    },
  })
}

/**
 * Hook to update a job
 */
export function useUpdateJob() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<JobFormData> }) =>
      jobService.updateJob(id, data),
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: ['jobs', user?.id] })

      const previousJobs = queryClient.getQueryData<Job[]>(['jobs', user?.id])

      queryClient.setQueryData<Job[]>(['jobs', user?.id], (old) =>
        old?.map((job) => (job.id === id ? { ...job, ...data } : job))
      )

      return { previousJobs }
    },
    onError: (_err, _variables, context) => {
      if (context?.previousJobs) {
        queryClient.setQueryData(['jobs', user?.id], context.previousJobs)
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: ['jobs', user?.id] })
      queryClient.invalidateQueries({
        queryKey: ['job-status-history', user?.id, variables.id],
      })
      queryClient.invalidateQueries({ queryKey: ['job-status-history', user?.id] })
    },
  })
}

/**
 * Hook to update job status
 */
export function useUpdateJobStatus() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: JobStatus }) =>
      jobService.updateJobStatus(id, status),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ['jobs', user?.id] })
      const previousJobs = queryClient.getQueryData<Job[]>(['jobs', user?.id])

      queryClient.setQueryData<Job[]>(['jobs', user?.id], (old) =>
        old?.map((job) => (job.id === id ? { ...job, status } : job))
      )

      return { previousJobs }
    },
    onError: (_err, _variables, context) => {
      if (context?.previousJobs) {
        queryClient.setQueryData(['jobs', user?.id], context.previousJobs)
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: ['jobs', user?.id] })
      queryClient.invalidateQueries({
        queryKey: ['job-status-history', user?.id, variables.id],
      })
      queryClient.invalidateQueries({ queryKey: ['job-status-history', user?.id] })
    },
  })
}

/**
 * Hook to delete a job
 */
export function useDeleteJob() {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation({
    mutationFn: (id: string) => jobService.deleteJob(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['jobs', user?.id] })
      const previousJobs = queryClient.getQueryData<Job[]>(['jobs', user?.id])

      queryClient.setQueryData<Job[]>(['jobs', user?.id], (old) =>
        old?.filter((job) => job.id !== id)
      )

      return { previousJobs }
    },
    onError: (_err, _id, context) => {
      if (context?.previousJobs) {
        queryClient.setQueryData(['jobs', user?.id], context.previousJobs)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs', user?.id] })
    },
  })
}

/**
 * Hook to auto-fill job fields from a posting URL.
 */
export function useAutofillJobFromUrl() {
  return useMutation({
    // `html` is the bookmarklet's captured page source; without it this is
    // the fetch path it has always been.
    mutationFn: ({ url, html }: { url: string; html?: string }) =>
      jobService.autofillFromUrl(url, html),
  })
}
