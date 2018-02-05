FROM developmentseed/geolambda:cloud

ENV HOME /home/geolambda

COPY requirements.txt $BUILD/requirements.txt

RUN \
    pip install -r requirements.txt

COPY img-stats.py $HOME/img-stats.py
WORKDIR /home/geolambda

CMD [$HOME/img-stats.py]
