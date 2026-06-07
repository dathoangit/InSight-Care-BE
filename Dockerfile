FROM node:20

RUN apt-get update && apt-get install -y ffmpeg

RUN npm i -g @nestjs/cli typescript ts-node

WORKDIR /usr/src/app

COPY package*.json /usr/src/app
COPY yarn.lock /usr/src/app
RUN cd /usr/src/app && yarn

COPY . /usr/src/app

RUN npm run build:prod

CMD [ "yarn", "start:prod" ]
