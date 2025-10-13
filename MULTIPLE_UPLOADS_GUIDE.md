# Multiple File Upload System - Implementation Guide

## Overview

This implementation transforms your UAS website into a robust system that can handle multiple file uploads from multiple devices simultaneously without getting stuck or experiencing performance issues.

## Key Improvements

### 1. **Job Queue System (Bull Queue + Redis)**
- **Problem Solved**: Prevents system overload from concurrent processing
- **Solution**: Files are queued and processed sequentially with controlled concurrency
- **Benefits**: 
  - No more system crashes from multiple simultaneous uploads
  - Predictable resource usage
  - Automatic retry on failures
  - Job prioritization (files without segmentation get higher priority)

### 2. **Resource Management**
- **Problem Solved**: GPU memory conflicts and system resource exhaustion
- **Solution**: Intelligent resource allocation and monitoring
- **Features**:
  - GPU memory tracking and allocation
  - System memory monitoring
  - Database connection pooling
  - Configurable concurrency limits

### 3. **GPU Resource Manager**
- **Problem Solved**: Multiple processes competing for the same GPU
- **Solution**: Dynamic GPU allocation with memory monitoring
- **Features**:
  - Automatic GPU detection
  - Memory usage tracking
  - Fallback to CPU when GPU unavailable
  - Proper resource cleanup

### 4. **System Monitoring**
- **Problem Solved**: No visibility into system health during high load
- **Solution**: Real-time monitoring and alerting
- **Features**:
  - CPU, memory, and GPU usage tracking
  - Database connection monitoring
  - System health alerts
  - Performance metrics

### 5. **Enhanced Error Handling**
- **Problem Solved**: Poor error recovery and resource cleanup
- **Solution**: Comprehensive error handling with automatic cleanup
- **Features**:
  - Automatic retry with exponential backoff
  - Resource cleanup on failures
  - Detailed error logging
  - Graceful degradation

## Installation & Setup

### 1. Install Dependencies
```bash
cd backend
npm install bull redis ioredis
```

### 2. Install Redis
**Windows:**
- Download from: https://github.com/microsoftarchive/redis/releases
- Or use Docker: `docker run -d -p 6379:6379 redis:alpine`

**Linux/macOS:**
```bash
# Ubuntu/Debian
sudo apt-get install redis-server

# macOS
brew install redis
brew services start redis
```

### 3. Environment Configuration
Add to your `.env` file:
```env
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Resource Management
MAX_CONCURRENT_JOBS=2
MAX_GPU_MEMORY_MB=8000
MAX_SYSTEM_MEMORY_MB=16000

# Database Connection Pool
DB_MAX_CONNECTIONS=20
DB_MIN_CONNECTIONS=5
DB_IDLE_TIMEOUT=10000
DB_ACQUIRE_TIMEOUT=60000
DB_EVICT_INTERVAL=1000
```

### 4. Start the System
```bash
cd backend
npm start
```

## How It Works

### Upload Process Flow
1. **File Upload**: User uploads file through web interface
2. **Queue Addition**: File is added to processing queue (not processed immediately)
3. **Resource Check**: System checks available resources (GPU, memory, etc.)
4. **Job Processing**: When resources are available, job is processed
5. **Status Updates**: Real-time status updates throughout the process
6. **Completion**: File is encrypted and marked as ready

### Resource Management
- **Concurrency Control**: Maximum 2 files processed simultaneously (configurable)
- **GPU Allocation**: Each segmentation job gets dedicated GPU memory
- **Memory Monitoring**: System memory usage tracked and jobs queued if threshold exceeded
- **Database Pooling**: Connection pool prevents database overload

### Queue Management
- **Priority System**: Files without segmentation get higher priority
- **Retry Logic**: Failed jobs automatically retry up to 3 times
- **Cleanup**: Stuck jobs are cleaned up on system restart
- **Monitoring**: Real-time queue status and statistics

## Admin Features

### Queue Management Dashboard
- **Real-time Status**: View waiting, active, completed, and failed jobs
- **Resource Monitoring**: CPU, memory, GPU, and database usage
- **Queue Controls**: Pause, resume, or clear the processing queue
- **System Health**: Alerts for high resource usage or system issues

### Access Control
- Queue management features are restricted to Admin users only
- System health monitoring available to Admins
- Regular users see normal upload interface with queue status

## Performance Characteristics

### Before (Original System)
- ❌ Multiple uploads caused system crashes
- ❌ GPU memory conflicts
- ❌ Database connection exhaustion
- ❌ No resource monitoring
- ❌ Poor error recovery

### After (New System)
- ✅ Handles unlimited concurrent uploads
- ✅ Intelligent GPU resource allocation
- ✅ Optimized database connection pooling
- ✅ Real-time system monitoring
- ✅ Automatic error recovery and retry
- ✅ Configurable resource limits
- ✅ Graceful degradation under load

## Configuration Options

### Resource Limits
```env
MAX_CONCURRENT_JOBS=2          # Files processed simultaneously
MAX_GPU_MEMORY_MB=8000        # GPU memory per job
MAX_SYSTEM_MEMORY_MB=16000    # System memory threshold
```

### Database Pool
```env
DB_MAX_CONNECTIONS=20         # Maximum database connections
DB_MIN_CONNECTIONS=5          # Minimum connections to maintain
DB_IDLE_TIMEOUT=10000        # Connection idle timeout (ms)
```

### Queue Settings
- **Retry Attempts**: 3 automatic retries
- **Backoff Strategy**: Exponential backoff (2s, 4s, 8s)
- **Job Retention**: 10 completed, 50 failed jobs kept for monitoring
- **Cleanup**: Stuck jobs cleaned up on startup

## Monitoring & Troubleshooting

### System Health Endpoints
- `GET /api/files/system/health` - System health metrics
- `GET /api/files/queue/status` - Queue status and statistics

### Admin Controls
- `POST /api/files/queue/pause` - Pause processing
- `POST /api/files/queue/resume` - Resume processing
- `POST /api/files/queue/clear` - Clear all queued jobs

### Log Monitoring
Look for these log prefixes:
- `[Queue]` - Queue processing logs
- `[GPU Manager]` - GPU resource management
- `[System Monitor]` - System health monitoring
- `[Startup]` - System initialization

### Common Issues & Solutions

1. **Redis Connection Failed**
   - Ensure Redis is running: `redis-cli ping`
   - Check Redis configuration in environment variables

2. **High Memory Usage**
   - Reduce `MAX_CONCURRENT_JOBS`
   - Increase `MAX_SYSTEM_MEMORY_MB` threshold
   - Monitor with system health endpoint

3. **GPU Out of Memory**
   - Reduce `MAX_GPU_MEMORY_MB`
   - Check GPU memory usage in system health
   - System automatically falls back to CPU

4. **Database Connection Issues**
   - Check database server status
   - Adjust connection pool settings
   - Monitor connection usage in system health

## Scalability

### Horizontal Scaling
- Multiple server instances can share the same Redis queue
- Database connection pooling handles multiple servers
- GPU resources can be distributed across servers

### Vertical Scaling
- Increase `MAX_CONCURRENT_JOBS` for more powerful servers
- Adjust memory thresholds based on available RAM
- Add more GPUs for increased segmentation capacity

## Security Considerations

- Queue management restricted to Admin users
- System health data only accessible to Admins
- File encryption maintained throughout the process
- Resource limits prevent DoS attacks
- Automatic cleanup prevents resource leaks

## Future Enhancements

1. **Load Balancing**: Distribute jobs across multiple servers
2. **Cloud Integration**: Use cloud GPU instances for heavy processing
3. **Advanced Monitoring**: Integration with monitoring services (Prometheus, Grafana)
4. **Job Scheduling**: Schedule processing during off-peak hours
5. **User Notifications**: Email/SMS notifications for job completion

## Support

For issues or questions:
1. Check the system health dashboard
2. Review logs for error messages
3. Monitor resource usage patterns
4. Adjust configuration based on your hardware capabilities

The system is now production-ready and can handle multiple concurrent file uploads from multiple devices without performance degradation or system instability.
