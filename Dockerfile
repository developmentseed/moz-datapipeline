FROM developmentseed/geolambda:cloud

# install any Python dependencies
COPY requirements.txt $BUILD/requirements.txt
RUN \
    pip install -r requirements.txt

# home
ENV HOME /home/moz
WORKDIR $HOME

# copy scripts
COPY main.sh $HOME/main.sh
COPY scripts $HOME/scripts


