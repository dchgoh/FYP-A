# System Configuration Guide

## Environment Variables

Add these environment variables to your `.env` file in the backend directory:

### Database Configuration
```env
DB_USER=your_db_user
DB_HOST=localhost
DB_PASSWORD=your_db_password
DB_PORT=5432
DB_NAME=your_db_name

# Database Connection Pool Settings
DB_MAX_CONNECTIONS=20
DB_MIN_CONNECTIONS=5
DB_IDLE_TIMEOUT=10000
DB_ACQUIRE_TIMEOUT=60000
DB_EVICT_INTERVAL=1000
```

### Redis Configuration (for Bull Queue)
```env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
```

### Resource Management
```env
MAX_CONCURRENT_JOBS=2
MAX_GPU_MEMORY_MB=8000
MAX_SYSTEM_MEMORY_MB=16000
```

### JWT Secret
```env
JWT_SECRET=your_jwt_secret_here
```

### Server Configuration
```env
PORT=5000
NODE_ENV=development
```

## Redis Installation

### Windows
1. Download Redis from: https://github.com/microsoftarchive/redis/releases
2. Install and start Redis service
3. Or use Docker: `docker run -d -p 6379:6379 redis:alpine`

### Linux/macOS
```bash
# Ubuntu/Debian
sudo apt-get install redis-server

# macOS with Homebrew
brew install redis
brew services start redis

# Or with Docker
docker run -d -p 6379:6379 redis:alpine
```

## System Requirements

### Minimum Requirements
- **CPU**: 4 cores
- **RAM**: 8GB
- **GPU**: 4GB VRAM (optional, falls back to CPU)
- **Storage**: 50GB free space
- **Redis**: Required for queue system

### Recommended Requirements
- **CPU**: 8+ cores
- **RAM**: 16GB+
- **GPU**: 8GB+ VRAM
- **Storage**: 100GB+ free space
- **Redis**: Dedicated Redis server

## Performance Tuning

### Database Connection Pool
- `DB_MAX_CONNECTIONS`: Maximum concurrent database connections
- `DB_MIN_CONNECTIONS`: Minimum connections to maintain
- Adjust based on your database server capacity

### Resource Limits
- `MAX_CONCURRENT_JOBS`: Number of files that can be processed simultaneously
- `MAX_GPU_MEMORY_MB`: Maximum GPU memory per job
- `MAX_SYSTEM_MEMORY_MB`: System memory threshold for job queuing

### Queue Configuration
- Jobs are processed with exponential backoff on failure
- Failed jobs are retried up to 3 times
- Queue maintains last 10 completed and 50 failed jobs for monitoring

## Monitoring

### System Health Endpoints
- `GET /api/files/system/health` - System health metrics
- `GET /api/files/queue/status` - Queue status and statistics

### Admin Controls
- `POST /api/files/queue/pause` - Pause processing queue
- `POST /api/files/queue/resume` - Resume processing queue
- `POST /api/files/queue/clear` - Clear all queued jobs

## Troubleshooting

### Common Issues

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
   - Consider using CPU fallback for large files

4. **Database Connection Issues**
   - Check database server status
   - Adjust connection pool settings
   - Monitor connection usage in system health

### Logs
- Queue processing logs: Look for `[Queue]` prefix
- GPU management logs: Look for `[GPU Manager]` prefix
- System monitoring logs: Look for `[System Monitor]` prefix
