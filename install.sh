#! /bin/bash

apt-get update
apt-get -y upgrade
apt-get install -y gdal-bin libsqlite3-dev zlib1g-dev python-pip gdal-bin python-gdal apt-transport-https ca-certificates software-properties-common curl

# Utils - Remove afterwards
apt-get install -y curl git build-essential make

# Install Docker (Needed for docker in docker)
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | apt-key add -
add-apt-repository \
   "deb [arch=amd64] https://download.docker.com/linux/ubuntu \
   $(lsb_release -cs) \
   stable"
apt-get update
apt-get install -y docker-ce
# allow Docker to be used without sudo
groupadd docker
usermod -aG docker $USER

# Python tools
pip install awscli --upgrade --user
pip install csvkit

# Node JS 8.x
curl -sL https://deb.nodesource.com/setup_8.x | bash -
apt-get install -y nodejs

# Yarn package manager
curl -sS https://dl.yarnpkg.com/debian/pubkey.gpg | apt-key add -
echo "deb https://dl.yarnpkg.com/debian/ stable main" | tee /etc/apt/sources.list.d/yarn.list
apt-get update
apt-get install -y yarn

# Tippecanoe
mkdir -p /tmp/tippecanoe-src
cd /tmp/tippecanoe-src
git clone --branch 1.27.6 https://github.com/mapbox/tippecanoe.git /tmp/tippecanoe-src
make && make install

## Housekeeping
cd /
rm -rf /tmp/tippecanoe-src
apt-get -y remove --purge build-essential make
apt-get -y autoremove
