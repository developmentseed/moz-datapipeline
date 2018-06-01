FROM ubuntu:latest

COPY ./install.sh /

RUN bash install.sh
RUN pip install awscli --upgrade --user
ENV PATH="/root/.local/bin:${PATH}"

RUN mkdir -p /var/pipeline
WORKDIR /var/pipeline
COPY ./package.json /var/pipeline
COPY ./scripts /var/pipeline/scripts
COPY ./script-eaul /var/pipeline/script-eaul

RUN yarn install

CMD bash script-eaul/eaul.sh
