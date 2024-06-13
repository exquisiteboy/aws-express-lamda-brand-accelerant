const { google } = require('googleapis');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const xml2js = require('xml2js');
const OpenAI = require('openai');
const { CloudWatchClient, GetMetricWidgetImageCommand } = require('@aws-sdk/client-cloudwatch');
const {
    SES,
    SendEmailCommand
} = require('@aws-sdk/client-ses');
// Load the credentials from the downloaded JSON file
const CREDENTIALS_PATH = 'google_service_account.json';
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];
var SPREADSHEET_ID = '1Z3WrW133CetCBRdrFJ95mu4qrrJkntesfRjZOLx-2hw';
const RANGE = 'B:B';
// async function authorize() {
//     const auth = new google.auth.GoogleAuth({
//       keyFile: CREDENTIALS_PATH,
//       scopes: SCOPES,
//     });
//     const authClient = await auth.getClient();
//     return authClient;
//   }
//   async function getSheetData(auth) {
//     const sheets = google.sheets({ version: 'v4', auth });
//     const response = await sheets.spreadsheets.values.get({
//       spreadsheetId: SPREADSHEET_ID,
//       range: RANGE,
//     });
//     return response.data.values;
//   }

//   async function downloadContent(url) {
//     const response = await fetch(url);
//     const content = await response.text();
//     const filePath = path.join(__dirname, 'downloaded_content.txt');
//     fs.writeFileSync(filePath, content);
//     return filePath;
//   }

//   async function downloadImageAsBase64(url) {
//     const response = await fetch(url);
//     const buffer = await response.buffer();
//     return buffer.toString('base64');
//   }

//   async function main() {
//     const auth = await authorize();
//     const rows = await getSheetData(auth);

//     if (!rows.length) {
//       console.log('No data found.');
//       return;
//     }
//     const urls = rows.map(row => row[0]).filter(url => url && url.startsWith('http'));

//     if (!urls.length) {
//       console.log('No valid URLs found.');
//       return;
//     }

//     const randomUrl = urls[Math.floor(Math.random() * urls.length)];
//     const filePath = await downloadImageAsBase64(randomUrl);

//     console.log(`Content downloaded and saved to ${filePath}`);
//   }

async function authorize() {
    const auth = new google.auth.GoogleAuth({
        keyFile: CREDENTIALS_PATH,
        scopes: SCOPES,
    });
    const authClient = await auth.getClient();
    return authClient;
}

async function getSheetData(auth) {
    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: RANGE,
    });
    return response.data.values;
}

async function downloadContent(url) {
    const response = await axios.get(url);
    const content = response.data;
    const filePath = path.join(__dirname, 'downloaded_content.txt');
    fs.writeFileSync(filePath, content);
    return filePath;
}

async function downloadImageAsBase64(url) {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data, 'binary');
    return buffer.toString('base64');
}

async function main(req) {
    console.log(req.body.sheet_id)
    SPREADSHEET_ID = req.body.sheet_id ? req.body.sheet_id : SPREADSHEET_ID;
    const auth = await authorize();
    const rows = await getSheetData(auth);

    if (!rows.length) {
        console.log('No data found.');
        return;
    }

    const urls = rows.map(row => row[0]).filter(url => url && url.startsWith('http'));

    if (!urls.length) {
        console.log('No valid URLs found.');
        return;
    }

    const randomUrl = urls[Math.floor(Math.random() * urls.length)];
    // const filePath = await downloadContent(randomUrl);

    // console.log(`Content downloaded and saved to ${filePath}`);
    return randomUrl;
}

async function fetchRSSFeed(url) {
    const response = await axios.get(url);
    return response.data;
}

async function parseRSSFeed(xml) {
    return new Promise((resolve, reject) => {
        xml2js.parseString(xml, (err, result) => {
            if (err) reject(err);
            resolve(result);
        });
    });
}

async function extractDataFromRSS(feed) {
    const items = feed.rss.channel[0].item;
    const data = items.map(item => ({
        title: item.title[0],
        description: item.description[0]
    }));
    return data;
}

const openai = new OpenAI({ 'apiKey': process.env.OPEN_AI_KEY });

async function getAWSConfig(){
    let config = {
        // The key apiVersion is no longer supported in v3, and can be removed.
        // @deprecated The client uses the "latest" apiVersion.
        apiVersion: '2010-12-01',
    
        credentials: {
            accessKeyId: process.env.AWS_KEY,
            secretAccessKey: process.env.AWS_SECRET
        },
    
        // e.g., 'us-east-1'
        region: 'us-east-1'
        // region: 'us-west-1'
    };
    return config;
}



async function getAIContentAndImage(name, category, article = "true", image = "false") {
    var article_resp;
    var image_resp;
    try {
        const companyName = name;
        const articleCategory = category;
        if (!companyName || !articleCategory) {
            throw Error('params missing');
        }

        if (article == "true") {
            // Generate article prompt
            const articlePrompt = `Write an engaging and informative article about "${companyName}" for socializing platforms in the category of "${articleCategory}". The article should be tailored for social media, including elements that drive engagement such as catchy headlines, hashtags, and a call to action.`;
            const articleResponse = await openai.chat.completions.create({
                model: 'gpt-4',
                messages: [
                    { role: 'system', content: 'You are a helpful assistant.' },
                    { role: 'user', content: articlePrompt },
                ]
            });
            console.log(articleResponse.choices[0].message);
            article_resp = articleResponse.choices[0].message.content;
        }
        if (image == "true") {
            // Generate image prompt
            const imagePrompt = `Create a visually appealing image for an article about "${companyName}" in the category of "${articleCategory}". The image should be suitable for social media, engaging, and relevant to the article content.`;

            const imageResponse = await openai.images.generate({
                model: "dall-e-3",
                prompt: imagePrompt,
                n: 1,
                size: "1024x1024",
              });
              image_resp = imageResponse.data[0].url;

            console.log(imageResponse.data[0].url);
        }

        return {
            image_resp,
            article_resp
        };

    } catch (error) {
        console.error('Error generating content:', error);
        throw Error(error);
    }
};


function getSesClient(region = 'us-east-1'){
    return new SES({
        // The key apiVersion is no longer supported in v3, and can be removed.
        // @deprecated The client uses the "latest" apiVersion.
        apiVersion: '2010-12-01',
    
        credentials: {
            accessKeyId: process.env.AWS_KEY,
            secretAccessKey: process.env.AWS_SECRET
        },
    
        // e.g., 'us-east-1'
        region: region
        // region: 'us-west-1'
    });
}


async function getCloudWatchMetric(){
  try{
    config = await getAWSConfig();
    config['region'] = 'us-west-1';
    const clientCloudwatch = new CloudWatchClient(config);
    const input = { // GetMetricWidgetImageInput
        MetricWidget: `{
            "sparkline": true,
            "metrics": [
                [ "AWS/SES", "Delivery" ],
                [ ".", "Open" ],
                [ ".", "Reputation.BounceRate" ],
                [ ".", "Reputation.ComplaintRate" ],
                [ ".", "Send" ]
            ],
            "view": "bar",
            "stat": "Sum",
            "period": 300,
            "singleValueFullPrecision": true,
            "liveData": true,
            "setPeriodToTimeRange": true,
            "trend": true,
            "title": "Statistics",
            "width": 1349,
            "height": 200,
            "start": "-PT72H",
            "end": "P0D"
        }`, // required
        OutputFormat: "png",
    };
    const command = new GetMetricWidgetImageCommand(input);
    const response = await clientCloudwatch.send(command);
    var u8 = new Uint8Array(response.MetricWidgetImage);
    var data = Buffer.from(u8);
    let file_path = 'aws_ses_dashboard.png';
    fs.writeFile(`${file_path}`, data, err => { // Assets is a folder present in your root directory
        if (err) {
           console.log(err);
        } else {
           console.log('File created successfully!');
        }
    });

    //const contents = fs.readFileSync(file_path, {encoding: 'base64'});

    //var b64 = Buffer.from(u8).toString('base64');
    return [];
  }catch(err){
    console.log(err)
  }
};

async function buildEmailCommand(email, body, subject){
    const createSendEmailCommand = (toAddress, fromAddress, HTML_FORMAT_BODY, EMAIL_SUBJECT) => {
        return new SendEmailCommand({
          Destination: {
            /* required */
            CcAddresses: [
              /* more items */
            ],
            ToAddresses: [
              toAddress,
              /* more To-email addresses */
            ],
          },
          Message: {
            /* required */
            Body: {
              /* required */
              Html: {
                Charset: "UTF-8",
                Data: HTML_FORMAT_BODY,
              },
              Text: {
                Charset: "UTF-8",
                Data: HTML_FORMAT_BODY,
              },
            },
            Subject: {
              Charset: "UTF-8",
              Data: EMAIL_SUBJECT,
            },
          },
          Source: fromAddress
        });
      };
      const sendEmailCommand = createSendEmailCommand(
        email,
        "info@brandaccelerant.com",
        body,
        subject
      );
      return sendEmailCommand;
};



module.exports.getAIContentAndImage = getAIContentAndImage;
module.exports.extractDataFromRSS = extractDataFromRSS;
module.exports.parseRSSFeed = parseRSSFeed;
module.exports.fetchRSSFeed = fetchRSSFeed;
module.exports.getGoogleSheet = main;
module.exports.getCloudWatchMetric = getCloudWatchMetric;
module.exports.getSesClient = getSesClient;
module.exports.buildEmailCommand = buildEmailCommand;