'use strict';

const got = require('got');
const crypto = require('crypto')
const AWS = require("aws-sdk");
const AWSIot = require("aws-iot-device-sdk");

module.exports = class Redmond {
    constructor(username, password, region) {
        // Creds for Redmond API
        this.username = username;
        this.password = password;
        this.country_code = region;

        //Credentials
        this.aws_access_key_id;
        this.aws_secret_access_key;
        this.aws_session_token;

        this.aws_session;
        this.aws_identity_id;
        this.region;

        this.iot;
        this.iot_data;

        // Expiration time of session
        this.expiration_time;
        this.endpoint;
        this.init();
    }

    async init() {
        await this.get_session()
    }

    auth() {
        return new Promise(async (resolve, reject) => {
            if (!this.username) { console.log('Username is not provided via params'); return }
            if (!this.password) { console.log('Password is not provided via params'); return }
            if (!this.country_code) { console.log('Country Code is not provided via params'); return }

            const appKey = '1f9ba014d72549e99f4314a7d61604ee'
            const userAccount = this.country_code.replace('+', '00') + '-' + this.username;
            const requestId = this.generateQuickGuid();
            const timeStamp = Date.now();
            const signatureSource = 'App_Key=' + appKey + '&User_Account='+userAccount + '&Timestamp=' + timeStamp + '&Request_Id=' + requestId;

            const payload = {
                "User_Account": userAccount,
                "Password": crypto.createHash('md5').update(this.password).digest("hex"),
                "App_Version": "1.0.5",
                "App_Type": "android_1.0.5",
                "App_Id": "redmond",
                "Request_Id": requestId,
                "Timestamp": timeStamp,
                "Signature": crypto.createHash('sha256').update(signatureSource).digest("hex")
            };

            const { body } = await got.post('https://www.grit-tech.link/redmond/Redmond_Login_Ats', {
                json: payload,
                responseType: 'json'
            });
            resolve(body)
        })
    }

    auth_cognito(region, identity_Id, token) {
        return new Promise(async (resolve, reject) => {
            var cognitoidentity = new AWS.CognitoIdentity({ region: region })
            var params = {
                IdentityId: identity_Id,
                Logins: { // optional tokens, used for authenticated login
                    'cognito-identity.amazonaws.com': token
                }
            }
            cognitoidentity.getCredentialsForIdentity(params, function (err, data) {
                if (err) console.log(err, err.stack); // an error occurred
                else resolve(data);           // successful response
            });

        })
    }

    make_session_from_cognito(aws_creds, region) {
        return new Promise(async (resolve, reject) => {
            this.aws_access_key_id = aws_creds.Credentials.AccessKeyId
            this.aws_secret_access_key = aws_creds.Credentials.SecretKey
            this.aws_session_token = aws_creds.Credentials.SessionToken
            this.region = region

            AWS.config.update({
                accessKeyId: this.aws_access_key_id,
                secretAccessKey: this.aws_secret_access_key,
                sessionToken: this.aws_session_token,
                region: this.region
            });
            let lambda = new AWS.Lambda({ region: this.region })
            this.aws_session = lambda
            this.iot = new AWS.Iot()
            this.iot_data = new AWS.IotData({ endpoint: this.endpoint })

            resolve(lambda);
        })
    }

    is_renewal_required() {
        return Date.now() > Date.parse(this.expiration_time)
    }

    async get_session() {
        if (this.aws_session && !this.is_renewal_required()) return this.aws_session

        let redmond_data = await this.auth()
        if (redmond_data.Request_Result != 'success') { console.log('Could not authenticate'); return }

        this.endpoint = 'https://' + redmond_data['End_Point'];
        this.region = redmond_data['Region_Info']
        this.aws_identity_id = redmond_data['Identity_Id']

        let aws_creds = await this.auth_cognito(this.region, redmond_data['Identity_Id'], redmond_data['Token'])
        this.aws_creds = aws_creds
        this.expiration_time = aws_creds.Credentials.Expiration

        let session = await this.make_session_from_cognito(aws_creds, this.region)
        this.aws_session = session
        return session
    }
    async device_list() {
        return new Promise(async (resolve, reject) => {
            let session = this.aws_session
            if (!session) session = await this.get_session();

            var params = {
                FunctionName: "Redmond_User_Query_All_Thing",
                InvocationType: "RequestResponse",
                Payload: JSON.stringify({
                    "Device_Manager_Request": "query",
                    "Identity_Id": this.aws_identity_id,
                    "Region_Info": this.region
                })
            };

            session.invoke(params, function (err, data) {
                if (err) {
                    console.log(err, err.stack);
                    reject();
                } else {
                    var payload = JSON.parse(data.Payload);
                    resolve(payload ? payload.Room[0].Thing : {});
                }
            });
        });
    }

    async get_device_description(device, session = this.aws_session) {
        return new Promise(async (resolve, reject) => {
            if (!session) session = await this.get_session();

            var params = {
                thingName: device.Thing_Name
            };

            this.iot.describeThing(params, function (err, data) {
                data.Thing_Nick_Name = device.Thing_Nick_Name
                if (err) console.log(err, err.stack); // an error occurred
                else resolve(data);           // successful response
            });
        })

    }

    async get_device_shadow(device_name, session = this.aws_session) {
        if (!session) session = await this.get_session();

        var params = {
            thingName: device_name
        };

        this.iot_data.getThingShadow(params, function (err, data) {
            //console.log(data)
            if (err) console.log(err, err.stack); // an error occurred
            else console.log(JSON.parse(data.payload));           // successful response
        });

    }

    async publish_device_msg(device_name, desired_payload = {}, session = this.aws_session) {
        if (!session || this.is_renewal_required()) session = await this.get_session();

        var topic = "$aws/things/" + device_name + "/shadow/update"
        var payload = {
            state: {
                desired: desired_payload
            }
        }
        var params = {
            topic: topic,
            payload: JSON.stringify(payload),
            qos: 0
        };
        //console.log(params)
        this.iot_data.publish(params, function (err, data) {
            if (err) console.log(err, err.stack); // an error occurred
            //else console.log(data);           // successful response
        });
    }

    async getConnection() {
        return new Promise(async (resolve, reject) => {
            var client = AWSIot.device({
                region: AWS.config.region,
                host: this.endpoint.replace('https://', ''),
                clientId: 'mqtt-' + (Math.floor((Math.random() * 100000) + 1)),
                protocol: 'wss',
                maximumReconnectTimeMs: 8000,
                debug: false,
                accessKeyId: this.aws_access_key_id,
                secretKey: this.aws_secret_access_key,
                sessionToken: this.aws_session_token
            });
            resolve(client)
        })
    }

    generateQuickGuid() {
        return Math.random().toString(36).substring(2, 15) +
            Math.random().toString(36).substring(2, 15);
    }
}
