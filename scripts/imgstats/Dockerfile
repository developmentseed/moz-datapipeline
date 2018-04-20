FROM developmentseed/geolambda:full

WORKDIR /work

COPY requirements.txt  /work/
RUN \
    pip install -r requirements.txt

COPY img-stats.py /work/

ENTRYPOINT ["/work/img-stats.py"]
CMD []