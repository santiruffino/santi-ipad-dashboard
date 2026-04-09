module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');

    const CLIENT_ID = process.env.STRAVA_CLIENT_ID;
    const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
    const REFRESH_TOKEN = process.env.STRAVA_REFRESH_TOKEN;

    if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
        return res.status(500).json({ error: 'Strava environment variables missing' });
    }

    try {
        // 1. Exchange refresh token for an active access token
        const tokenParams = new URLSearchParams();
        tokenParams.append('client_id', CLIENT_ID);
        tokenParams.append('client_secret', CLIENT_SECRET);
        tokenParams.append('refresh_token', REFRESH_TOKEN);
        tokenParams.append('grant_type', 'refresh_token');

        const tokenResponse = await fetch('https://www.strava.com/oauth/token', {
            method: 'POST',
            body: tokenParams
        });

        if (!tokenResponse.ok) {
            const err = await tokenResponse.json();
            return res.status(tokenResponse.status).json({ error: 'Failed to authenticate with Strava', details: err });
        }

        const { access_token } = await tokenResponse.json();

        // 2. Fetch specific endpoints simultaneously
        const headers = { 'Authorization': `Bearer ${access_token}` };
        const [athleteRes, activitiesRes] = await Promise.all([
            fetch('https://www.strava.com/api/v3/athlete', { headers }),
            fetch('https://www.strava.com/api/v3/athlete/activities?per_page=30', { headers })
        ]);

        if (!athleteRes.ok || !activitiesRes.ok) {
            const athleteErr = athleteRes.ok ? null : await athleteRes.text();
            const activitiesErr = activitiesRes.ok ? null : await activitiesRes.text();
            return res.status(502).json({ 
                error: 'Failed to fetch data from Strava API',
                athleteStatus: athleteRes.status,
                activitiesStatus: activitiesRes.status,
                athleteError: athleteErr,
                activitiesError: activitiesErr
            });
        }

        const athleteData = await athleteRes.json();
        const activitiesData = await activitiesRes.json();

        // 3. Process Gear (Shoes & Bikes)
        const gear = [];
        if (athleteData.shoes) {
            athleteData.shoes.forEach(shoe => {
                gear.push({
                    id: shoe.id,
                    name: shoe.name,
                    primary: shoe.primary,
                    distance: (shoe.distance / 1000).toFixed(1),
                    type: 'shoe'
                });
            });
        }
        if (athleteData.bikes) {
            athleteData.bikes.forEach(bike => {
                gear.push({
                    id: bike.id,
                    name: bike.name,
                    primary: bike.primary,
                    distance: (bike.distance / 1000).toFixed(1),
                    type: 'bike'
                });
            });
        }

        // 4. Process Activities (Filters by Running)
        const runs = activitiesData.filter(a => a.type === 'Run');
        let lastActivity = null;
        let weeklyKm = 0;

        if (runs.length > 0) {
            const last = runs[0];
            lastActivity = {
                name: last.name,
                distance: (last.distance / 1000).toFixed(1),
                timeSecs: last.moving_time,
                date: last.start_date_local
            };
        }

        // Calculate Weekly KM (Starting from Monday)
        const now = new Date();
        // getDay() is 0 (Sun) to 6 (Sat)
        const currentDay = now.getDay();
        const daysSinceMonday = currentDay === 0 ? 6 : currentDay - 1;

        // Set to 00:00 on Monday
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - daysSinceMonday);
        startOfWeek.setHours(0, 0, 0, 0);

        runs.forEach(run => {
            const runDate = new Date(run.start_date_local);
            if (runDate >= startOfWeek) {
                weeklyKm += run.distance;
            }
        });

        const weeklyKmStr = (weeklyKm / 1000).toFixed(1);

        // 5. Build final response
        res.status(200).json({
            lastActivity,
            weeklyKm: weeklyKmStr,
            gear
        });

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
};
