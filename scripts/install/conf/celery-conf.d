CELERYD_NODES="worker1"
CELERY_BIN="/usr/local/bin/celery"
CELERYD_MULTI="multi"
CELERY_APP="worker.celery:app"
CELERYD_LOG_FILE="/var/log/celery/%N.log"
CELERYD_LOG_LEVEL="DEBUG"
CELERYD_PID_FILE="/var/run/celery/%N.pid"
CELERY_CREATE_DIRS=1
CELERYD_OPTS="--time-limit=240 --concurrency=2"