FROM python:3.12-slim
WORKDIR /app
COPY app.py /app/
COPY features.py maintenance.py project_workflows.py /app/
COPY static /app/static
ENV HOST=0.0.0.0 PORT=8765 APP_DB=/data/system.db APP_CONTAINER=1 COOKIE_SECURE=1
RUN useradd -m app && mkdir /data && chown app:app /data
USER app
VOLUME /data
EXPOSE 8765
CMD ["python","app.py"]
