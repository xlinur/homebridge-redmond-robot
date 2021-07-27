# Homebridge Redmond Robot

This is a plugin for [Homebridge](https://github.com/nfarina/homebridge) to control your **Redmond Cleaning Vacuum.** 

This plugin supports following functions:

- **Power Switch** (on/off)

## Installation instructions
After [Homebridge](https://github.com/nfarina/homebridge) has been installed:

```
$ sudo npm install -g homebridge-redmond-robot
```

## Basic configuration

 ```
{
	"bridge": {
		...
	},

	"platforms": [
        {
            "username": "USER", # E-Mail or Phone (Phone without Country-Code) e.g 123456 not +49123456
            "password": "PASS", # "Account Password."
            "country": "+7", # Country-Code
            "startMode": "AutoClean",
            "stopMode": "BackCharging",
            "platform": "HomebridgeRedmondRobot"
        }
    ]
}

 ```

Or with homebridge-config-ui


## Valid Modes
* SmartClean
* AutoClean
* EdgeClean
* SpotClean
* RoomClean
* Standby
* BackCharging
