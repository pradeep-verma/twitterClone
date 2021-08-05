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

const initializeServerAndDatabase = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server running at http://localhost:3000/");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};
initializeServerAndDatabase();

const authenticateToken = (request, response, next) => {
  const authHeader = request.headers["authorization"];
  let jwtToken;
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (authHeader === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "secret_key", (error, payload) => {
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

const isTweetIdValid = async (userId, tweetId) => {
  const getUserfollowingTweetsQuery = `
        SELECT tweet_id
        FROM follower
        INNER JOIN tweet ON tweet.user_id = follower.following_user_id
        WHERE follower.follower_user_id = ${userId};
    `;
  const userfollowingTweets = await db.all(getUserfollowingTweetsQuery);
  let found = false;
  for (eachObj of userfollowingTweets) {
    if (tweetId == eachObj.tweet_id) {
      found = true;
    }
  }
  return found;
};

// Register API 1
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const passwordLength = password.length;
  const hashedPassword = await bcrypt.hash(password, 10);
  const getUserQuery = `
    SELECT *
    FROM user
    WHERE 
    username = '${username}';
  `;
  const dbUser = await db.get(getUserQuery);
  if (dbUser === undefined) {
    if (passwordLength < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const addUserQuery = `
            INSERT INTO 
            user (name, username, password, gender)
            VALUES (
                '${name}',
                '${username}',
                '${hashedPassword}',
                '${gender}'
            );
        `;
      await db.run(addUserQuery);
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
  const getUserQuery = `
    SELECT *
    FROM user
    WHERE 
    username = '${username}';
  `;
  const dbUser = await db.get(getUserQuery);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {
      const payload = {
        username: username,
        userId: dbUser.user_id,
      };
      const jwtToken = jwt.sign(payload, "secret_key");
      response.send({ jwtToken });
      console.log(jwtToken);
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

// API 3
app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const { username, userId } = request;
  const getTweetsQuery = `
    SELECT 
    username,
    tweet,
    date_time AS dateTime
    FROM follower
    INNER JOIN user ON user.user_id = follower.following_user_id
    INNER JOIN tweet ON tweet.user_id = user.user_id
    WHERE 
    follower.follower_user_id = '${userId}'
    ORDER BY 
    date_time DESC
    LIMIT 4;
    `;
  const tweets = await db.all(getTweetsQuery);
  response.send(tweets);
});

// API 4
app.get("/user/following/", authenticateToken, async (request, response) => {
  const { username, userId } = request;
  const getNamesQuery = `
    SELECT user.name
    FROM follower
    INNER JOIN user ON follower.following_user_id = user.user_id
    WHERE 
    follower.follower_user_id = ${userId};
    `;
  const names = await db.all(getNamesQuery);
  response.send(names);
});

// API 5
app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { username, userId } = request;
  const getNamesQuery = `
    SELECT user.name
    FROM follower
    INNER JOIN user ON follower.follower_user_id = user.user_id
    WHERE follower.following_user_id = ${userId};
    `;
  const names = await db.all(getNamesQuery);
  response.send(names);
});

// API 6
app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { username, userId } = request;
  const { tweetId } = request.params;
  let isTweetValid = isTweetIdValid(userId, tweetId);
  if (isTweetValid === false) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    const getTweetQuery = `
    SELECT 
    tweet,
    COUNT(like_id) AS likes,
    (SELECT COUNT(*) FROM reply WHERE tweet_id = ${tweetId}) AS replies,
    date_time AS dateTime
    FROM tweet
    LEFT JOIN like ON like.tweet_id = tweet.tweet_id
    WHERE 
    tweet.tweet_id = ${tweetId};
    `;
    const tweet = await db.get(getTweetQuery);
    response.send(tweet);
  }
});

// API 7
app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const { username, userId } = request;
    const { tweetId } = request.params;
    let isTweetValid = isTweetIdValid(userId, tweetId);
    if (isTweetValid === false) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const getUsernamesQuery = `
        SELECT username
        FROM
        like
        NATURAL JOIN user
        WHERE 
        tweet_id = ${tweetId};
    `;
      const usernames = await db.all(getUsernamesQuery);
      let usernameList = [];
      for (eachObj of usernames) {
        usernameList.push(eachObj.username);
      }
      const usernameLikedObj = { likes: usernameList };
      response.send(usernameLikedObj);
    }
  }
);

// API 8
app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const { username, userId } = request;
    const { tweetId } = request.params;
    let isTweetValid = isTweetIdValid(userId, tweetId);
    if (isTweetValid === false) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const getNameReplyQuery = `
        SELECT name, reply
        FROM
        reply
        NATURAL JOIN user
        WHERE 
        tweet_id = ${tweetId};
    `;
      const nameReplyList = await db.all(getNameReplyQuery);
      let repliesList = [];
      for (eachObj of nameReplyList) {
        repliesList.push({
          name: eachObj.name,
          reply: eachObj.reply,
        });
      }
      const usernameReplyObj = { replies: repliesList };
      response.send(usernameReplyObj);
    }
  }
);

// API 9
app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { username, userId } = request;
  const getTweetsQuery = `
    SELECT 
    tweet,
    COUNT(like_id) AS likes,
    COUNT(reply_id) AS replies,
    date_time AS dateTime
    FROM tweet
    LEFT JOIN like ON like.tweet_id = tweet.tweet_id
    LEFT JOIN reply ON reply.tweet_id = like.tweet_id
    WHERE 
    tweet.user_id = ${userId}
    GROUP BY 
    tweet.tweet_id;
    `;
  const tweets = await db.all(getTweetsQuery);
  response.send(tweets);
});

// API 10
app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { username, userId } = request;
  const { tweet } = request.body;
  let date = new Date();
  console.log(date);
  const addTweetQuery = `
        INSERT INTO 
        tweet (tweet, user_id, date_time)
        VALUES (
            '${tweet}',
            ${userId},
            '${date}'
        );
    `;
  await db.run(addTweetQuery);
  response.send("Created a Tweet");
});

// API 11
app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { username, userId } = request;
    const { tweetId } = request.params;

    const getUserTweetsQuery = `
        SELECT tweet_id
        FROM tweet
        WHERE user_id = ${userId};
    `;
    const userTweets = await db.all(getUserTweetsQuery);
    console.log(userTweets);
    let found = false;
    for (eachObj of userTweets) {
      if (tweetId == eachObj.tweet_id) {
        found = true;
      }
    }

    if (found === false) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const deleteTweetQuery = `
        DELETE FROM 
        tweet
        WHERE 
        tweet_id = ${tweetId};
    `;
      await db.run(deleteTweetQuery);
      response.send("Tweet Removed");
    }
  }
);

module.exports = app;
