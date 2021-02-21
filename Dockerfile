FROM nikolaik/python-nodejs:python3.8-nodejs15

RUN apt-get update && apt-get install -y swig libpcre++ locales
RUN sed -i -e 's/# en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' /etc/locale.gen && dpkg-reconfigure --frontend=noninteractive locales

WORKDIR /opt/kontext

COPY ./scripts/install/steps.py ./scripts/install/
COPY ./scripts/install/*.patch ./scripts/install/
COPY ./lib/plugins/default_auth ./lib/plugins/default_auth
COPY requirements.txt requirements.txt
RUN pip3 install -r requirements.txt
RUN python3 scripts/install/steps.py SetupManatee --step_args 2.167.8 scripts/install/ucnk-manatee-2.167.8.patch 0

COPY ./pack*.json ./
RUN npm install

COPY . .
RUN python3 scripts/install/steps.py SetupKontext
RUN npm start build:production

RUN pip3 install gunicorn
RUN mkdir /var/log/gunicorn
RUN mkdir /var/log/gunicorn/kontext

RUN mkdir /var/log/rq