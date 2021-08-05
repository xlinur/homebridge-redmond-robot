import { Service, PlatformAccessory, CharacteristicValue, Logger } from 'homebridge';
import { RedmondRobotPlatform } from './platform';
const vacuum = require('./lib/vacuum.js');

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class SwitchAccessory {
  private service: Service;

  /**
   * These are just used to create a working example
   * You should implement your own code to track the state of your accessory
   */
  private state = {
    On: false,
    BatteryLevel: 100,
    Charging: true,
  };

  private redmond;
  private client;

  constructor(
    private readonly platform: RedmondRobotPlatform,
    private readonly accessory: PlatformAccessory,
    public readonly log: Logger,
  ) {
    // redmond
    const redmond = accessory.context.redmond;
    this.redmond = redmond;

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'RedmondRobot')
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.device.thingName)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.attributes.mac)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, accessory.context.device.attributes.firmware_version);

    // get the LightBulb service if it exists, otherwise create a new LightBulb service
    // you can create multiple services for each accessory
    this.service = this.accessory.getService(this.platform.Service.Switch) || this.accessory.addService(this.platform.Service.Switch);

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.nickname);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/Lightbulb

    // register handlers for the On/Off Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))                // SET - bind to the `setOn` method below
      .onGet(this.getOn.bind(this));               // GET - bind to the `getOn` method below

    // create a new Battery service
    const batteryService = this.accessory.getService(this.platform.Service.Battery) || this.accessory.addService(this.platform.Service.Battery);

    // create handlers for required characteristics
    batteryService.getCharacteristic(this.platform.Characteristic.StatusLowBattery)
      .onGet(this.handleStatusLowBatteryGet.bind(this));

    batteryService.getCharacteristic(this.platform.Characteristic.BatteryLevel)
      .onGet(this.handleBatteryLevelGet.bind(this));

    //const _this = this
    this.redmond.getConnection().then((client) => {
      this.client = client;
      const deviceTopic = '$aws/things/' + accessory.context.device.thingName + '/shadow/update/delta';
      const getTopic = '$aws/things/' + accessory.context.device.thingName + '/shadow/get';
      const getTopicAccepted = '$aws/things/' + accessory.context.device.thingName + '/shadow/get/accepted';

      client.subscribe(deviceTopic);
      client.subscribe(getTopicAccepted);
      client.publish(getTopic, '');

      client.on('message', (topic, msg) => {
        if (!topic.includes(accessory.context.device.thingName)) return;
        if (!Object.prototype.hasOwnProperty.call(JSON.parse(msg.toString()), 'state')) return;
        const message = JSON.parse(msg.toString());
        if (Object.prototype.hasOwnProperty.call(message.state, 'working_status')) {
          const mode = message.state.working_status;
          const state = vacuum.isCleaning(mode);
          const isCharging = vacuum.isCharging(mode);
          this.state.Charging = isCharging;
          this.state.On = state;
          this.log.info(accessory.context.nickname, mode);
          this.service.updateCharacteristic(this.platform.Characteristic.On, state);
          batteryService.updateCharacteristic(this.platform.Characteristic.ChargingState, isCharging);
        }
        if (!Object.prototype.hasOwnProperty.call(JSON.parse(msg.toString()).state, 'reported')) return;
        if (Object.prototype.hasOwnProperty.call(message.state.reported, 'working_status')) {
          const mode = message.state.reported.working_status;
          const state = vacuum.isCleaning(mode);
          const isCharging = vacuum.isCharging(mode);
          this.state.Charging = isCharging;
          this.state.On = state;
          this.log.info(accessory.context.nickname, mode);
          this.service.updateCharacteristic(this.platform.Characteristic.On, state);
          batteryService.updateCharacteristic(this.platform.Characteristic.ChargingState, isCharging);
        }
        if (Object.prototype.hasOwnProperty.call(message.state.reported, 'battery_level')) {
          const battery_level = message.state.reported.battery_level;
          this.state.BatteryLevel = battery_level;
          this.log.info(accessory.context.nickname, battery_level);
          batteryService.updateCharacteristic(this.platform.Characteristic.BatteryLevel, battery_level);
        }
      });
    });
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, turning on a Light bulb.
   */
  async setOn(value: CharacteristicValue) {
    // implement your own code to turn your device on/off
    this.state.On = value as boolean;
    const mode = this.state.On ? this.accessory.context.modes.startMode : this.accessory.context.modes.stopMode;
    const topic = '$aws/things/' + this.accessory.context.device.thingName + '/shadow/update';
    const payload = {
      state: {
        desired: { working_status: mode },
      },
    };
    this.client.publish(topic, JSON.stringify(payload));

    this.platform.log.info('Set Characteristic On ->', value);
  }

  /**
   * Handle the "GET" requests from HomeKit
   * These are sent when HomeKit wants to know the current state of the accessory, for example, checking if a Light bulb is on.
   *
   * GET requests should return as fast as possbile. A long delay here will result in
   * HomeKit being unresponsive and a bad user experience in general.
   *
   * If your device takes time to respond you should update the status of your device
   * asynchronously instead using the `updateCharacteristic` method instead.

   * @example
   * this.service.updateCharacteristic(this.platform.Characteristic.On, true)
   */
  async getOn(): Promise<CharacteristicValue> {
    // implement your own code to check if the device is on
    const isOn = this.state.On;

    this.platform.log.info('Get Characteristic On ->', isOn);

    // get state
    const topic = '$aws/things/' + this.accessory.context.device.thingName + '/shadow/get';
    this.client.publish(topic, '');

    // if you need to return an error to show the device as "Not Responding" in the Home app:
    // throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);

    return isOn;
  }

  async handleStatusLowBatteryGet(): Promise<CharacteristicValue> {
    // set this to a valid value for StatusLowBattery
    const batteryLevel = this.state.BatteryLevel;
    let state = this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
    if(batteryLevel < 20){
      state = this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
    }

    return state;
  }

  async handleBatteryLevelGet(): Promise<CharacteristicValue> {
    // set this to a valid value for StatusLowBattery
    const batteryLevel = this.state.BatteryLevel;
    return batteryLevel;
  }
}
