import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API_BASE_URL = "/api";

export const useQueueStatus = () => {
    const [queueStatus, setQueueStatus] = useState({
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        resourceUsage: {},
        limits: {},
    });
    const [systemHealth, setSystemHealth] = useState({
        status: 'unknown',
        metrics: {},
        alerts: [],
    });
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);

    const fetchQueueStatus = useCallback(async () => {
        try {
            const token = localStorage.getItem('token');
            const response = await axios.get(`${API_BASE_URL}/files/queue/status`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (response.data.success) {
                setQueueStatus(response.data.queue);
            }
        } catch (err) {
            console.error('Error fetching queue status:', err);
            setError(err.response?.data?.message || 'Failed to fetch queue status');
        }
    }, []);

    const fetchSystemHealth = useCallback(async () => {
        try {
            const token = localStorage.getItem('token');
            const response = await axios.get(`${API_BASE_URL}/files/system/health`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (response.data.success) {
                setSystemHealth(response.data.health);
            }
        } catch (err) {
            console.error('Error fetching system health:', err);
            setError(err.response?.data?.message || 'Failed to fetch system health');
        }
    }, []);

    const pauseQueue = useCallback(async () => {
        try {
            setIsLoading(true);
            const token = localStorage.getItem('token');
            const response = await axios.post(`${API_BASE_URL}/files/queue/pause`, {}, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (response.data.success) {
                await fetchQueueStatus();
                return { success: true, message: response.data.message };
            }
        } catch (err) {
            console.error('Error pausing queue:', err);
            return { success: false, message: err.response?.data?.message || 'Failed to pause queue' };
        } finally {
            setIsLoading(false);
        }
    }, [fetchQueueStatus]);

    const resumeQueue = useCallback(async () => {
        try {
            setIsLoading(true);
            const token = localStorage.getItem('token');
            const response = await axios.post(`${API_BASE_URL}/files/queue/resume`, {}, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (response.data.success) {
                await fetchQueueStatus();
                return { success: true, message: response.data.message };
            }
        } catch (err) {
            console.error('Error resuming queue:', err);
            return { success: false, message: err.response?.data?.message || 'Failed to resume queue' };
        } finally {
            setIsLoading(false);
        }
    }, [fetchQueueStatus]);

    const clearQueue = useCallback(async () => {
        try {
            setIsLoading(true);
            const token = localStorage.getItem('token');
            const response = await axios.post(`${API_BASE_URL}/files/queue/clear`, {}, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (response.data.success) {
                await fetchQueueStatus();
                return { success: true, message: response.data.message };
            }
        } catch (err) {
            console.error('Error clearing queue:', err);
            return { success: false, message: err.response?.data?.message || 'Failed to clear queue' };
        } finally {
            setIsLoading(false);
        }
    }, [fetchQueueStatus]);

    const refreshAll = useCallback(async () => {
        await Promise.all([fetchQueueStatus(), fetchSystemHealth()]);
    }, [fetchQueueStatus, fetchSystemHealth]);

    // Auto-refresh every 10 seconds
    useEffect(() => {
        refreshAll();
        const interval = setInterval(refreshAll, 10000);
        return () => clearInterval(interval);
    }, [refreshAll]);

    // Calculate queue efficiency
    const queueEfficiency = queueStatus.completed + queueStatus.failed > 0 
        ? Math.round((queueStatus.completed / (queueStatus.completed + queueStatus.failed)) * 100)
        : 100;

    // Calculate resource utilization
    const resourceUtilization = {
        cpu: systemHealth.metrics?.cpu?.usage || 0,
        memory: systemHealth.metrics?.memory?.usage || 0,
        database: systemHealth.metrics?.database?.usage || 0,
        gpu: systemHealth.metrics?.gpu?.totalGPUs > 0 
            ? Math.round((systemHealth.metrics.gpu.allocatedGPUs / systemHealth.metrics.gpu.totalGPUs) * 100)
            : 0,
    };

    return {
        queueStatus,
        systemHealth,
        isLoading,
        error,
        queueEfficiency,
        resourceUtilization,
        actions: {
            pauseQueue,
            resumeQueue,
            clearQueue,
            refreshAll,
        },
    };
};
