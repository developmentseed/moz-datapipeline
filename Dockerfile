FROM ubuntu:latest

COPY install.sh /

RUN bash install.sh
ENV PATH="/root/.local/bin:${PATH}"

RUN mkdir -p /var/pipeline
WORKDIR /var/pipeline
COPY ./main.sh /var/pipeline
COPY ./scripts /var/pipeline/scripts
