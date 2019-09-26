var Accessory, Service, Characteristic, hap, UUIDGen;

var FFMPEG = require('./ffmpeg').FFMPEG;
const http = require('http');
const ip = require('ip');

module.exports = function(homebridge) {
  Accessory = homebridge.platformAccessory;
  hap = homebridge.hap;
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  UUIDGen = homebridge.hap.uuid;

  homebridge.registerPlatform("homebridge-camera-ffmpeg-netmotion", "Camera-ffmpeg", ffmpegPlatform, true);
}

function ffmpegPlatform(log, config, api) {
  var self = this;
  self.log = log;
  self.config = config || {};
  
  self.motionPort = config.motionPort || 2500
  self.requestArray = ['motionDetected']

  self.autoResetMotion = config.autoResetMotion || false
  self.autoResetDelay = config.autoResetDelay || 1

  self.sensors = config.sensors
  self.configuredAccessories = []
  self.idArray = []

  self.server = http.createServer(function (request, response) {
    var parts = request.url.split('/')
    var partOne = parts[parts.length - 3]
    var partTwo = parts[parts.length - 2]
    var partThree = parts[parts.length - 1]
    if (parts.length === 4 && self.idArray.includes(partOne) && self.requestArray.includes(partTwo) && partThree.length === 1) {
      self.log('Handling request: %s', request.url)
      response.end('Handling request')
      _httpHandler(partOne, partTwo, partThree, self)
    } else {
      self.log.warn('Invalid request: %s', request.url)
      response.end('Invalid request')
    }
  }.bind(self))

  self.server.listen(self.motionPort, function () {
    self.log('Listen server: http://%s:%s', ip.address(), self.motionPort)
  }.bind(self))
  

  if (api) {
    self.api = api;

    if (api.version < 2.1) {
      throw new Error("Unexpected API version.");
    }

    self.api.on('didFinishLaunching', self.didFinishLaunching.bind(this));
  }
}

ffmpegPlatform.prototype.configureAccessory = function(accessory) {
  // Won't be invoked
}

ffmpegPlatform.prototype.didFinishLaunching = function() {
  var self = this;
  var videoProcessor = self.config.videoProcessor || 'ffmpeg';
  var interfaceName = self.config.interfaceName || '';

  if (self.config.cameras) {
    var cameras = self.config.cameras;
    cameras.forEach(function(cameraConfig, index) {
      var cameraName = cameraConfig.name;
      var videoConfig = cameraConfig.videoConfig;

      if (!cameraName || !videoConfig) {
        self.log("Missing parameters.");
        return;
      }
      
      var uuid = UUIDGen.generate(cameraName);
      var cameraAccessory = new Accessory(cameraName, uuid, hap.Accessory.Categories.CAMERA);
      var cameraAccessoryInfo = cameraAccessory.getService(Service.AccessoryInformation);
      if (cameraConfig.manufacturer) {
        cameraAccessoryInfo.setCharacteristic(Characteristic.Manufacturer, cameraConfig.manufacturer);
      }
      if (cameraConfig.model) {
        cameraAccessoryInfo.setCharacteristic(Characteristic.Model, cameraConfig.model);
      }
      if (cameraConfig.serialNumber) {
        cameraAccessoryInfo.setCharacteristic(Characteristic.SerialNumber, cameraConfig.serialNumber);
      }
      if (cameraConfig.firmwareRevision) {
        cameraAccessoryInfo.setCharacteristic(Characteristic.FirmwareRevision, cameraConfig.firmwareRevision);
      }

      cameraAccessory.context.log = self.log; 

      var motion = new Service.MotionSensor(cameraName);
      cameraAccessory.addService(motion);
      
      var motionid = cameraName.replace(/ /g,"_").toLowerCase() 
      self.idArray.push(motionid)

      var cameraSource = new FFMPEG(hap, cameraConfig, self.log, videoProcessor, interfaceName);
      cameraAccessory.configureCameraSource(cameraSource);
      self.configuredAccessories.push(cameraAccessory);
    });
    
    self.api.publishCameraAccessories("Camera-ffmpeg", self.configuredAccessories);
  }
};

function autoResetFunction(id, accessory, self) {
    self.log('%s | Waiting %s seconds to autoreset motion detection', id, self.autoResetDelay)
    setTimeout(() => {
      accessory.getService(Service.MotionSensor).setCharacteristic(Characteristic.MotionDetected, 0)
      self.log('%s | Autoreset motion detection', id)
    }, self.autoResetDelay * 1000)
  }

function _httpHandler(id, characteristic, value, self) {
    var index = self.idArray.indexOf(id)
    var accessory = self.configuredAccessories[index]
    switch (characteristic) {
      case 'motionDetected':
        accessory.getService(Service.MotionSensor).setCharacteristic(Characteristic.MotionDetected, value);
        self.log('%s | Updated %s to: %s', id, characteristic, value)
        if (parseInt(value) === 1 && self.autoResetMotion) {
          autoResetFunction(id, accessory, self)
        }
        break
      default:
        self.log.warn('%s | Unknown characteristic "%s" with value "%s"', id, characteristic, value)
    }
  }
