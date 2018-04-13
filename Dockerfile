FROM ubuntu:latest

COPY install.sh /

RUN bash install.sh

# Pythyon libs and command line tools
RUN \
	apt-get install -y gcc libgdal-dev; \
	pip install --upgrade pip; \
	pip install numpy;
COPY requirements.txt /
RUN \
	pip install -r requirements.txt

ENV PATH="/root/.local/bin:${PATH}"

RUN mkdir -p /var/pipeline
WORKDIR /var/pipeline
COPY ./package.json /var/pipeline
COPY ./main.sh /var/pipeline
COPY ./libs /var/pipeline/libs
COPY ./scripts /var/pipeline/scripts

RUN yarn install
