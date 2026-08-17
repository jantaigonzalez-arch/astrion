# Capa de inteligencia — imagen del servicio Python.
#
# `slim` de Debian y no Alpine, al contrario que el resto del stack. El motivo
# es medido y no una preferencia: numpy, scikit-learn, xgboost y polars
# publican ruedas precompiladas para glibc (manylinux) y NO para musl. En
# Alpine, `pip install` cae a compilar desde fuente —xgboost necesita CMake y
# un compilador de C++— y la imagen pasa de un par de minutos a media hora,
# cuando termina.
#
# Es el mismo criterio que llevó a elegir Polars sobre DuckDB en el lado de
# Node, y con el signo contrario: allí se eligió por tener binarios musl,
# aquí se cambia de base porque no los hay. La regla es la misma —que el
# despliegue no dependa de compilar nada— y esa regla es la que decide.

FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Las dependencias antes del código: la capa de instalación se reaprovecha
# mientras `pyproject.toml` no cambie, y el código cambia mucho más a menudo.
COPY pyproject.toml ./
RUN pip install --no-cache-dir \
      "fastapi>=0.115" "uvicorn[standard]>=0.32" "pydantic>=2.9" \
      "polars>=1.17" "pyarrow>=18.0" \
      "scikit-learn>=1.6" "statsmodels>=0.14" "numpy>=2.0" "xgboost>=2.1" \
      "psycopg[binary]>=3.2"

COPY app ./app

# Sin root. El servicio solo necesita leer del Postgres y responder HTTP; no
# escribe en disco, así que no hay motivo para darle más de lo que usa.
RUN useradd --create-home --uid 10001 astraion && chown -R astraion:astraion /app
USER astraion

EXPOSE 8000

# Un solo worker a propósito. Entrenar es CPU-intensivo y varios workers en el
# mismo contenedor se pelean por los núcleos con los hilos de scikit-learn y
# xgboost, que ya paralelizan por dentro. Si hace falta más capacidad, se
# escala el número de RÉPLICAS, no de workers.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
