const express = require("express");
const serverless = require("serverless-http");
const {
    SendEmailCommand
} = require('@aws-sdk/client-ses');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FB_APP_ID = process.env.FB_APP_ID;  // Replace with your Facebook App ID
const FB_APP_SECRET = process.env.FB_APP_SECRET;  // Replace with your Facebook App Secret
const {
    getGoogleSheet,
    fetchRSSFeed,
    parseRSSFeed,
    extractDataFromRSS,
    getAIContentAndImage,
    buildEmailCommand
} = require('./lib');

// console.log(FB_APP_ID);
const app = express();
// const port = 3000;
// const REDIRECT_URI = `https://vjs2pvwuwd.execute-api.us-east-2.amazonaws.com/auth/callback`;
const REDIRECT_URI = `http://localhost:3000/auth/callback`;
app.use(express.json());

app.get('/', (req, res) => {
    res.send('hello to aws');
});

app.get('/auth', (req, res) => {
    const authUrl = `https://www.facebook.com/v12.0/dialog/oauth?client_id=${FB_APP_ID}&redirect_uri=${REDIRECT_URI}&scope=pages_show_list,pages_read_engagement,email,pages_manage_posts,pages_manage_engagement,business_management`;
    res.redirect(authUrl);
});

app.get('/auth/callback', async (req, res) => {
    const code = req.query.code;
    const tokenUrl = `https://graph.facebook.com/v12.0/oauth/access_token?client_id=${FB_APP_ID}&redirect_uri=${REDIRECT_URI}&client_secret=${FB_APP_SECRET}&code=${code}`;

    try {
        const response = await axios.get(tokenUrl);
        const userAccessToken = response.data.access_token;
        const UserProfile = await getMe(userAccessToken);
        console.log(UserProfile);
        const pagesData = await getPagesAndTokens(userAccessToken);
        let url = `http://localhost/wordpress/?my_listener=test&email=${UserProfile?.email}&id=${UserProfile?.id}&user_secret=${UserProfile.id}&user_access_token=${userAccessToken}&page_id=${pagesData?.page?.id}&page_secret=${pagesData?.page?.access_token}`;
        res.redirect(url);
    } catch (error) {
        console.error('Error getting access token:', error.response ? error.response.data : error.message);
        res.send('Error getting access token');
    }
});

const getMe = async (userAccessToken) => {
    try {
        const response = await axios.get(`https://graph.facebook.com/v12.0/me?fields=name,email,id`, {
            headers: {
                'Authorization': `Bearer ${userAccessToken}`
            }
        });
        return response.data;
    } catch (error) {
        console.log('error', error);
        return {};
    }

};
const getPagesAndTokens = async (userAccessToken) => {
    try {
        const response = await axios.get(`https://graph.facebook.com/v12.0/me/accounts`, {
            headers: {
                'Authorization': `Bearer ${userAccessToken}`
            }
        });

        //console.log(response);

        const pages = response.data.data;

        if (pages.length > 0) {
            const firstPage = pages[0];
            const pageToken = firstPage.access_token;
            return { page: firstPage, pageToken };
        } else {
            console.log('No pages found.');
            return 'No pages found.';
        }
    } catch (error) {
        console.error('Error fetching pages:', error.response ? error.response.data : error.message);
        return 'Error fetching pages.';
    }
};

app.post('/getImageFromSheet', async (req, res) => {
    await getGoogleSheet(req).then(resp => res.send(resp)).catch(err => {
        res.send('');
    });
    req.next();
});

app.post('/post_to_facebook', async (req, resp) => {
    const { message, imageUrl, imagePath, pageId, accessToken } = req.body;
    if (!message || !pageId || !accessToken) {
        return resp.status(400).send({ error: 'Message, pageId, and accessToken are required' });
    }

    const url = `https://graph.facebook.com/${pageId}/photos`;
    const postData = {
        access_token: accessToken,
        caption: message
    };

    if (imageUrl) {
        postData.url = imageUrl;
    } else if (imagePath) {
        // Create a form and append image data
        const form = new FormData();
        form.append('caption', message);
        form.append('access_token', accessToken);
        form.append('source', fs.createReadStream(imagePath));

        try {
            const response = await axios.post(url, form, {
                headers: form.getHeaders()
            });
            resp.send({ postId: response });
        } catch (error) {
            console.error('Error posting to Facebook:', error.response ? error.response.data : error.message);
            return resp.status(500).send({ error: 'Failed to post to Facebook' });
        }
        return;
    } else {
        return resp.status(400).send({ error: 'Either imageUrl or imagePath must be provided' });
    }

    try {
        const response = await axios.post(url, postData);
        //console.log(response);
        if (response?.data?.error) {
            resp.send({ message: 'Unable to post to facebook',postId:'' });
        } else {
            resp.send({ message: 'Posted Successfully', postId: response.data.post_id });
        }
        //resp.send({ postId: response.data?.id });
    } catch (error) {
        console.error('Error posting to Facebook:', error.response ? error.response.data : error.message);
        resp.status(500).send({ error: 'Failed to post to Facebook' });
    }
});


app.post('/get-generated-content', async (req, resp) => {
    const { name, category, ai_image, ai_text } = req.body;
    if (!name || !category || !ai_image || !ai_text) {
        return resp.status(400).send({ error: 'Name, aiImage, aiText and Category are required' });
    }
    try {
        ai_generated = await getAIContentAndImage(name, category, ai_text, ai_image);
        resp.status(200).send({ 'response': ai_generated });
    } catch (error) {
        resp.status(200).send({ error: 'Unable to generate data' + error });
    }

});

app.get('/ses_email_metrics', (req, res) => {
    getCloudWatchMetric().then((data) => {
        res.json({
            'message': 'success',
            'data': data
        });
        res.end();
    }).catch((err) => {
        console.log(err)
    });
});

app.post('/send_email', async (req, res) => {
    const run = async (email, body, Subject) => {
        try {
            return await getSesClient('us-west-1').send(await buildEmailCommand(email, body, Subject));
        } catch (e) {
            console.error("Failed to send email.");
            return e;
        }
    };

    const { email, body, subject } = req.body;


    const isEmailValid = (email) => {
        const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@a-zA-Z0-9?(?:\.a-zA-Z0-9?)*$/;

        if (!email) return false;
        if (email.length > 254) return false;
        const valid = emailRegex.test(email);
        if (!valid) return false;
        console.log(email)

        // Further checking of some things regex can't handle
        const parts = email.split('@');
        if (parts[0].length > 64) return false;
        const domainParts = parts[1].split('.');
        if (domainParts.some(part => part.length > 63)) return false;

        return true;
    }

    // if(isEmailValid(params.email)){
    email_resp = await run(email, body, subject);
    res.json({
        message: 'Successfully sent',
        data: email_resp,
        success: true
    });
    // }else{
    //   return res.json({
    //     'message' : 'Bad Request',
    //     'success' : false
    //   });
    // }
});
app.post('/rss-data', async (req, res) => {
    const { feed_url } = req.body;
    console.log(feed_url);
    if (!feed_url) {
        res.json({ 'message': 'bad request' });
    }
    try {
        const xml = await fetchRSSFeed(feed_url);
        const feed = await parseRSSFeed(xml);
        const data = await extractDataFromRSS(feed);
        res.json(data);
    } catch (error) {
        console.log(error)
        res.status(500).send('Error parsing RSS feed');
    }
});

// app.listen(port, () => {
//     console.log(`app is listing on port ${port}`)
// })

module.exports.handler = serverless(app);