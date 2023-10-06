const express = require("express");
const path = require("path");

const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, "twitterClone.db");

let db = null;

const initializeDbAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server Running at http://localhost:3000");
    });
  } catch (error) {
    console.log(`DB Error: ${error.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();

// Middle Wear Function

const authentication = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        request.userId = payload.userId;
        next();
      }
    });
  }
};

// Get Following User Ids

const getFollowingPeopleIdsOfUser = async (username) => {
  const getFollowingPeopleIds = `
    SELECT 
      following_user_id 
    FROM 
      follower INNER JOIN user 
    ON 
      user.user_id = follower.follower_user_id 
    WHERE 
      user.username = '${username}';`;
  const followingPeople = await db.all(getFollowingPeopleIds);
  const followingArray = followingPeople.map(
    (eachUser) => eachUser.following_user_id
  );
  return followingArray;
};

// Tweet Access Verification

const tweetAccessVerification = async (request, response, next) => {
  const { tweetId } = request.params;
  const { userId } = request;
  const getTweetQuery = `
    SELECT 
      * 
    FROM 
      tweet INNER JOIN follower 
    ON 
      tweet.user_id = follower.following_user_id 
    WHERE 
      tweet.tweet_id = '${tweetId}' AND follower.follower_user_id = '${userId}';`;
  const tweet = await db.get(getTweetQuery);
  if (tweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

// Convert Tweets DB Object TO Response Object API 3

const convertDbObjectToResponseObject = (dbObject) => {
  return {
    username: dbObject.username,
    tweet: dbObject.tweet,
    dateTime: dbObject.date_time,
  };
};

// Create User API 1

app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const getUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const userData = await db.get(getUserQuery);
  if (userData === undefined) {
    const createUserQuery = `
      INSERT INTO 
        user(name,username,password,gender)
      VALUES
        ('${name}','${username}','${hashedPassword}','${gender}');`;
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const newUserDetails = await db.run(createUserQuery);
      response.status(200);
      response.send("User created successfully");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

// Login API 2

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const getUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await db.get(getUserQuery);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {
      const payload = { username: username, userId: dbUser.user_id };
      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      response.status(200);
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

// Get User Tweets API 3

app.get("/user/tweets/feed/", authentication, async (request, response) => {
  const { username } = request;
  const followingPeopleIds = await getFollowingPeopleIdsOfUser(username);
  const getTweetsQuery = `
    SELECT 
      * 
    FROM 
      user INNER JOIN tweet 
    ON 
      user.user_id = tweet.user_id 
    WHERE 
      user.user_id IN (${followingPeopleIds})
    ORDER BY 
      date_time DESC
    LIMIT 4`;
  const tweets = await db.all(getTweetsQuery);
  response.send(
    tweets.map((eachTweet) => convertDbObjectToResponseObject(eachTweet))
  );
});

// Get User Following API 4

app.get("/user/following/", authentication, async (request, response) => {
  const { username, userId } = request;
  const getFollowingUserQuery = `
    SELECT 
      name 
    FROM 
      follower INNER JOIN user 
    ON 
      user.user_id = follower.following_user_id
    WHERE 
      follower_user_id = '${userId}';`;
  const getDetails = await db.all(getFollowingUserQuery);
  response.send(getDetails);
});

// Get User Followers API 5

app.get("/user/followers/", authentication, async (request, response) => {
  const { username, userId } = request;
  const getUserFollowersQuery = `
    SELECT 
      DISTINCT name  
    FROM 
      follower INNER JOIN user 
    ON 
      user.user_id = follower.follower_user_id
    WHERE 
      following_user_id = '${userId}';`;
  const getFollowers = await db.all(getUserFollowersQuery);
  response.send(getFollowers);
});

// Get Tweet API 6

app.get(
  "/tweets/:tweetId/",
  authentication,
  tweetAccessVerification,
  async (request, response) => {
    const { username, userId } = request;
    const { tweetId } = request.params;
    const getTweetQuery = `
      SELECT 
        tweet,
        (SELECT COUNT() FROM like WHERE tweet_id = '${tweetId}') AS likes,
        (SELECT COUNT() FROM reply WHERE tweet_id  = '${tweetId}') AS replies,
        date_time AS dateTime 
      FROM 
        tweet
      WHERE 
        tweet.tweet_id = '${tweetId}';`;
    const tweet = await db.get(getTweetQuery);
    response.send(tweet);
  }
);

// GET User Likes API 7

app.get(
  "/tweets/:tweetId/likes/",
  authentication,
  tweetAccessVerification,
  async (request, response) => {
    const { tweetId } = request.params;
    const getLikesQuery = `
      SELECT 
        username 
      FROM 
        user INNER JOIN like 
      ON 
        user.user_id = like.user_id
      WHERE 
        tweet_id = '${tweetId}';`;
    const likesQuery = await db.all(getLikesQuery);
    const likesArray = likesQuery.map((eachUser) => eachUser.username);
    response.send({ likes: likesArray });
  }
);

// Get Replies User API 8

app.get(
  "/tweets/:tweetId/replies/",
  authentication,
  tweetAccessVerification,
  async (request, response) => {
    const { tweetId } = request.params;
    const getRepliesQuery = `
      SELECT 
        name,
        reply 
      FROM 
        USER INNER JOIN reply 
      ON 
        user.user_id = reply.user_id
      WHERE 
        tweet_id = '${tweetId}';`;
    const getReplies = await db.all(getRepliesQuery);
    response.send({ replies: getReplies });
  }
);

// Get User Tweets API 9

app.get("/user/tweets/", authentication, async (request, response) => {
  const { userId } = request;
  const getTweetsQuery = ` 
      SELECT 
        tweet,
        COUNT(DISTINCT like_id) AS likes,
        COUNT(DISTINCT reply_id) AS replies,
        date_time AS dateTime 
      FROM 
        tweet LEFT JOIN reply 
      ON 
        tweet.tweet_id = reply.tweet_id 
        LEFT JOIN like ON tweet.tweet_id = like.tweet_id
      WHERE 
        tweet.user_id = '${userId}'
      GROUP BY tweet.tweet_id;`;
  const tweets = await db.all(getTweetsQuery);
  response.send(tweets);
});

// Create tweet API 10

app.post("/user/tweets/", authentication, async (request, response) => {
  const { tweet } = request.body;
  const userId = parseInt(request.userId);
  const dateTime = new Date().toJSON().substring(0, 19).replace("T", " ");
  const createTweetQuery = `
    INSERT INTO 
      tweet(tweet,user_id,date_time)
    VALUES 
      ('${tweet}','${userId}','${dateTime}');`;
  await db.run(createTweetQuery);
  response.send("Created a Tweet");
});

// Delete Tweet API 11

app.delete("/tweets/:tweetId/", authentication, async (request, response) => {
  const { tweetId } = request.params;
  const { userId } = request;
  const getTweetQuery = `SELECt * FROM tweet WHERE user_id = '${userId}' AND tweet_id = '${tweetId}';`;
  const tweet = await db.get(getTweetQuery);
  if (tweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    const deleteQuery = `DELETE FROM tweet WHERE tweet_id = '${tweetId}';`;
    await db.run(deleteQuery);
    response.send("Tweet Removed");
  }
});

module.exports = app;
