# AmneziaWG Quick

On Ubuntu, one command installs the console menu and the web panel:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/master-eugene/amnezia-wg-quick/master/install.sh)
```

The command downloads this repository, installs AmneziaWG, and starts the panel in Docker. It asks for sudo when you are not already root. Running it again updates both and keeps existing clients and the panel account. The two do not share accounts.

From a checkout on the server:

```bash
sudo bash install.sh
```

## Console

Open the menu:

```bash
sudo awq
```

```
1  Current clients
2  Add client
3  Change status
4  Client info
5  Remove client
6  Exit
```

Client info can show a QR code or the text config. State is stored in `/var/lib/amnezia-wg-quick`.

## Docker panel

Open `http://<server>:51821` and create the admin account. Choose another host port with:

```bash
sudo bash install.sh --port 8443
```

The account lives in the `panel-data` volume and survives a re-run.

The panel listens over HTTP. Use an SSH tunnel or HTTPS before exposing it on the internet. Sessions last 12 hours and end when the container restarts.

Set `TRUST_PROXY=1` in the environment only when a reverse proxy sets `X-Forwarded-For`.

## Local panel

```bash
cd panel
npm install
npm start
```

Open `http://127.0.0.1:51821`.
