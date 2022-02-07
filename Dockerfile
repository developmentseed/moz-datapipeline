FROM ubuntu:18.04

COPY install.sh /

RUN bash install.sh
ENV PATH="/root/.local/bin:${PATH}"

RUN mkdir -p /var/pipeline
WORKDIR /var/pipeline
COPY ./package.json /var/pipeline
COPY ./.env /var/pipeline
COPY ./libs /var/pipeline/libs
COPY ./scripts /var/pipeline/scripts

ENV NVM_DIR /usr/local/nvm
ENV NODE_VERSION 8

# Install nvm with node and npm
RUN curl https://raw.githubusercontent.com/creationix/nvm/v0.30.1/install.sh | bash \
    && . $NVM_DIR/nvm.sh \
    && nvm install $NODE_VERSION \
    && nvm alias default $NODE_VERSION \
    && nvm use default


ENV NODE_PATH $NVM_DIR/v$NODE_VERSION/lib/node_modules
ENV PATH      $NVM_DIR/versions/node/v$NODE_VERSION/bin:$PATH
RUN node -v

RUN yarn install
