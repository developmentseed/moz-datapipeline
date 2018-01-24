FROM ubuntu:latest

RUN mkdir -p /var/pipeline
WORKDIR /var/pipeline
COPY ./main.sh /var/pipeline
COPY ./scripts /var/pipeline/scripts

RUN apt-get update
RUN apt-get install -y gdal-bin