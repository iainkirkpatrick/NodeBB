
'use strict';

var topics = require('../topics'),
	categories = require('../categories'),
	threadTools = require('../threadTools'),
	index = require('./index'),
	user = require('../user'),
	db = require('./../database'),
	meta = require('./../meta'),

	async = require('async'),

	SocketTopics = {};

SocketTopics.post = function(socket, data, callback) {

	if(!data) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	if (!socket.uid && !parseInt(meta.config.allowGuestPosting, 10)) {
		return callback(new Error('[[error:not-logged-in]]'));
	}

	topics.post({uid: socket.uid, title: data.title, content: data.content, cid: data.category_id, thumb: data.topic_thumb}, function(err, result) {
		if(err) {
			return callback(err);
		}

		if (result) {

			index.server.sockets.in('category_' + data.category_id).emit('event:new_topic', result.topicData);
			index.server.sockets.in('recent_posts').emit('event:new_topic', result.topicData);
			index.server.sockets.in('home').emit('event:new_topic', result.topicData);
			index.server.sockets.in('home').emit('event:new_post', {
				posts: result.postData
			});
			index.server.sockets.in('user/' + socket.uid).emit('event:new_post', {
				posts: result.postData
			});

			module.parent.exports.emitTopicPostStats();

			callback();
		}
	});
};

SocketTopics.postcount = function(socket, tid, callback) {
	topics.getTopicField(tid, 'postcount', callback);
};

SocketTopics.markAsRead = function(socket, data) {
	if(!data || !data.tid || !data.uid) {
		return;
	}

	topics.markAsRead(data.tid, data.uid, function(err) {
		topics.pushUnreadCount(data.uid);
		topics.markTopicNotificationsRead(data.tid, data.uid);
	});
};

SocketTopics.markTidsRead = function(socket, tids, callback) {

	if (!Array.isArray(tids)) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	topics.markTidsRead(socket.uid, tids, function(err) {
		if(err) {
			return callback(err);
		}

		topics.pushUnreadCount(socket.uid);

		for (var i=0; i<tids.length; ++i) {
			topics.markTopicNotificationsRead(tids[i], socket.uid);
		}

		callback();
	});
};

SocketTopics.markAllRead = function(socket, data, callback) {
	topics.getUnreadTids(socket.uid, 0, -1, function(err, tids) {
		if (err) {
			return callback(err);
		}

		SocketTopics.markTidsRead(socket, tids, callback);
	});
};

SocketTopics.markCategoryTopicsRead = function(socket, cid, callback) {
	topics.getUnreadTids(socket.uid, 0, -1, function(err, tids) {
		if (err) {
			return callback(err);
		}

		var keys = tids.map(function(tid) {
			return 'topic:' + tid;
		});

		db.getObjectsFields(keys, ['tid', 'cid'], function(err, topicData) {
			if (err) {
				return callback(err);
			}

			tids = topicData.filter(function(topic) {
				return parseInt(topic.cid, 10) === parseInt(cid, 10);
			}).map(function(topic) {
				return topic.tid;
			});

			SocketTopics.markTidsRead(socket, tids, callback);
		});

	});
};

SocketTopics.markAsUnreadForAll = function(socket, tid, callback) {
	topics.markAsUnreadForAll(tid, function(err) {
		if(err) {
			return callback(err);
		}

		db.sortedSetAdd('topics:recent', Date.now(), tid, function(err) {
			if(err) {
				return callback(err);
			}
			topics.pushUnreadCount();
			callback();
		});
	});
};

SocketTopics.delete = function(socket, tid, callback) {
	doTopicAction('delete', socket, tid, callback);
};

SocketTopics.restore = function(socket, tid, callback) {
	doTopicAction('restore', socket, tid, callback);
};

SocketTopics.lock = function(socket, tid, callback) {
	doTopicAction('lock', socket, tid, callback);
};

SocketTopics.unlock = function(socket, tid, callback) {
	doTopicAction('unlock', socket, tid, callback);
};

SocketTopics.pin = function(socket, tid, callback) {
	doTopicAction('pin', socket, tid, callback);
};

SocketTopics.unpin = function(socket, tid, callback) {
	doTopicAction('unpin', socket, tid, callback);
};

function doTopicAction(action, socket, tid, callback) {
	if(!tid) {
		return callback(new Error('[[error:invalid-tid]]'));
	}

	threadTools.privileges(tid, socket.uid, function(err, privileges) {
		if(err) {
			return callback(err);
		}

		if(!privileges || !privileges.editable) {
			return callback(new Error('[[error:no-privileges]]'));
		}

		if(threadTools[action]) {
			threadTools[action](tid, socket.uid, callback);
		}
	});
}

SocketTopics.createTopicFromPosts = function(socket, data, callback) {
	if(!socket.uid) {
		return callback(new Error('[[error:not-logged-in]]'));
	}

	if(!data || !data.title || !data.pids || !Array.isArray(data.pids)) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	topics.createTopicFromPosts(socket.uid, data.title, data.pids, callback);
};

SocketTopics.movePost = function(socket, data, callback) {
	if(!socket.uid) {
		return callback(new Error('[[error:not-logged-in]]'));
	}

	if(!data || !data.pid || !data.tid) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	threadTools.privileges(data.tid, socket.uid, function(err, privileges) {
		if(err) {
			return callback(err);
		}

		if(!(privileges.admin || privileges.moderator)) {
			return callback(new Error('[[error:no-privileges]]'));
		}

		topics.movePostToTopic(data.pid, data.tid, callback);
	});
};

SocketTopics.move = function(socket, data, callback) {
	if(!data || !data.tid || !data.cid) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	threadTools.move(data.tid, data.cid, function(err) {
		if(err) {
			return callback(err);
		}

		index.server.sockets.in('topic_' + data.tid).emit('event:topic_moved', {
			tid: data.tid
		});

		callback(null);
	});
};

SocketTopics.followCheck = function(socket, tid, callback) {
	threadTools.isFollowing(tid, socket.uid, callback);
};

SocketTopics.follow = function(socket, tid, callback) {
	if(!socket.uid) {
		return callback(new Error('[[error:not-logged-in]]'));
	}

	threadTools.toggleFollow(tid, socket.uid, callback);
};

SocketTopics.loadMore = function(socket, data, callback) {
	if(!data || !data.tid || !(parseInt(data.after, 10) >= 0))  {
		return callback(new Error('[[error:invalid-data]]'));
	}

	user.getSettings(socket.uid, function(err, settings) {
		if(err) {
			return callback(err);
		}

		var start = parseInt(data.after, 10),
			end = start + settings.postsPerPage - 1;

		async.parallel({
			posts: function(next) {
				topics.getTopicPosts(data.tid, start, end, socket.uid, false, next);
			},
			privileges: function(next) {
				threadTools.privileges(data.tid, socket.uid, next);
			}
		}, callback);
	});
};

SocketTopics.loadMoreRecentTopics = function(socket, data, callback) {
	if(!data || !data.term || !data.after) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	var start = parseInt(data.after, 10),
		end = start + 9;

	topics.getLatestTopics(socket.uid, start, end, data.term, callback);
};

SocketTopics.loadMoreUnreadTopics = function(socket, data, callback) {
	if(!data || !data.after) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	var start = parseInt(data.after, 10),
		end = start + 9;

	topics.getUnreadTopics(socket.uid, start, end, callback);
};

SocketTopics.loadMoreFromSet = function(socket, data, callback) {
	if(!data || !data.after || !data.set) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	var start = parseInt(data.after, 10),
		end = start + 9;

	topics.getTopicsFromSet(socket.uid, data.set, start, end, callback);
};

SocketTopics.getPageCount = function(socket, tid, callback) {
	topics.getPageCount(tid, socket.uid, callback);
};

SocketTopics.getTidPage = function(socket, tid, callback) {
	topics.getTidPage(tid, socket.uid, callback);
};

SocketTopics.getTidIndex = function(socket, tid, callback) {
	categories.getTopicIndex(tid, callback);
};

module.exports = SocketTopics;
