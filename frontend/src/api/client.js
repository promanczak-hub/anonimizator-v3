/**
 * API Client for Anonimizator backend
 */
import axios from 'axios'

const API_URL = import.meta.env.VITE_API_URL || ''

const api = axios.create({
    baseURL: `${API_URL}/api`,
    headers: {
        'Content-Type': 'application/json',
    },
})

// Jobs API
export const jobs = {
    create: async (file, options = {}) => {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('mode', options.mode || 'unify')
        formData.append('policy_preset', options.policyPreset || 'default')
        formData.append('pricing_strategy', options.pricingStrategy || 'final_only')
        if (options.description) formData.append('description', options.description)
        if (options.tags) formData.append('tags', options.tags)

        const response = await api.post('/jobs', formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
        })
        return response.data
    },

    get: async (jobId) => {
        const response = await api.get(`/jobs/${jobId}`)
        return response.data
    },

    list: async (params = {}) => {
        const response = await api.get('/jobs', { params })
        return response.data
    },

    submitDecisions: async (jobId, decisions) => {
        const response = await api.post(`/jobs/${jobId}/decisions`, decisions)
        return response.data
    },

    render: async (jobId) => {
        const response = await api.post(`/jobs/${jobId}/render`)
        return response.data
    },

    getThumbnailUrl: (jobId, page) => `${API_URL}/api/jobs/${jobId}/thumbnail/${page}`,

    getDownloadUrl: (jobId, fileType) => `${API_URL}/api/jobs/${jobId}/download/${fileType}`,

    delete: async (jobId) => {
        const response = await api.delete(`/jobs/${jobId}`)
        return response.data
    },
}

// Documents API
export const documents = {
    list: async (params = {}) => {
        const response = await api.get('/documents', { params })
        return response.data
    },

    get: async (documentId) => {
        const response = await api.get(`/documents/${documentId}`)
        return response.data
    },

    update: async (documentId, data) => {
        const response = await api.patch(`/documents/${documentId}`, data)
        return response.data
    },

    delete: async (documentId) => {
        const response = await api.delete(`/documents/${documentId}`)
        return response.data
    },
}

// Health check
export const health = {
    check: async () => {
        const response = await api.get('/health')
        return response.data
    },
}

export default { jobs, documents, health }
