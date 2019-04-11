var wss = require('../socket/socket');
var _ = require('underscore');
var db = require('../database/database');
var dateFormat = require('dateformat');
var notification = require('./NotificationHelper');
var config = require('config');
var moment = require('moment');
var utilityHelper = require('../helpers/Utility');
var ChatHelper = {
    clients: [],
    run: function () {
        var self = this;
        wss.on('connection', function (ws) {
            ws.on('message', function (message) {
                console.log(message);
                try {
                    let messageJson = JSON.parse(message);
                    if (typeof self[messageJson.command] !== 'undefined') {
                        let execute = self[messageJson.command];
                        execute(self, messageJson.data, ws);
                    }
                } catch (e) {
                    console.log(e);
                }
            });
            ws.on('close', function () {
                self.removeClinet(ws);
                console.log('Socket Closed');
            });
            ws.on('error', function (err) {
                console.log(err);
            });
        });
    },
    connect: function (self, data, ws) {
        self.clients.push({user: data, socket: ws});
        self.logoutAllDevices(self, data, ws);
        self.statusSend(self, ws, 'online');
    },
    logoutAllDevices: function(self, data, ws) {
        var socketPushData = {};
        socketPushData.command = 'logout_device';
        var removableUsers = _.filter(self.clients,function(obj){
            return (parseInt(obj.user.id) === parseInt(data.id)) && (obj.socket !== ws);
        });
        _.each(removableUsers,function(val){
            val.socket.send(JSON.stringify(socketPushData), function (error) {
                console.log(error);
            });
        });
    },
    message: function (self, data, ws) {
        data.command = 'message';
        data.is_muted = 0;
        var now = new Date();
        var currentTime = moment.utc().format('YYYY-MM-DD HH:mm:ss');
        if (data.type === 'one') {
            data.group_id = '';
            data.group_name = '';
            data.group_image = '';
            data.thumb = '';
            data.url = '';
            if (data.content_type !== 'text') {
                data.url = '/uploads/' + data.content_name;
            }
            if (data.content_type === 'video') {
                data.url = '/uploads/' + data.content_name;
            }
            data.created = currentTime;
            data.timestamp = Math.round((new Date()).getTime() / 1000);
            let clients = _.filter(self.clients, function (val) {
                return (parseInt(val.user.id) === parseInt(data.from_id)) || (parseInt(val.user.id) === parseInt(data.to_id));
            });
            var toClient = _.filter(clients, function (val) {
                return (parseInt(val.user.id) === parseInt(data.to_id));
            });
            db.query("SELECT * FROM `mute_info` WHERE `from_id` = ? AND `to_id` = ? AND `type` = ?", [data.to_id, data.from_id, data.type], function (mErr, mResult) {
                if (!mErr) {
                    if (mResult.length) {
                        data.is_muted = parseInt(mResult[0].status);
                    }
                }
                db.query('INSERT INTO chat SET from_id = ?, to_id = ?, message = ?, type = ?, content_type = ?, content_name = ?, media_duration = ?,created = ?', [data.from_id, data.to_id, data.message, data.type, data.content_type, data.content_name, data.media_duration, currentTime], function (err, results) {
                    if (!err) {
                        data.id = results.insertId;
                        _.each(clients, function (val) {
                            data.its_you = 'NO';
                            if (val.socket === ws) {
                                data.its_you = 'YES';
                            }
                            if(typeof val.user.fcm_token !== 'undefined' && val.user.fcm_token === 'web') {
                                data.created = utilityHelper.timeZoneChange(currentTime, config.get('timezone'));
                            }
                            val.socket.send(JSON.stringify(data));
                        });
                        if (!toClient.length) {
                            db.query("SELECT * FROM `settings` WHERE  `user_id` = ?", [data.to_id], function (sErr, sResult) {
                                var notificationEnabled = 1;
                                if (!sErr) {
                                    if (sResult.length) {
                                        notificationEnabled = parseInt(sResult[0].notifications);
                                    }

                                }
                                if (notificationEnabled) {
                                    db.query('SELECT * FROM users_login WHERE user_id = ? AND is_loggedin = "1" GROUP BY `fcm_token`', [data.to_id], function (err, results) {
                                        _.each(results, function (val) {
                                            if (parseInt(val.deviceId) === 3) {
                                                var message = data;
                                                message.to = val.fcm_token;
                                            } else {
                                                var message = {
                                                    to: val.fcm_token,
                                                    data: data
                                                };
                                            }
                                            notification.sendNotification(message);
                                        });
                                    });
                                }
                            });
                        }
                    }
                });
            });
        } else if (data.type === 'two') {
            data.thumb = '';
            data.url = '';
            if (data.content_type !== 'text') {
                data.url = '/uploads/' + data.content_name;
            }
            if (data.content_type === 'video') {
                data.url = '/uploads/' + data.content_name;
            }
            data.created = currentTime;
            data.timestamp = Math.round((new Date()).getTime() / 1000);
            db.query('INSERT INTO chat SET from_id = ?, to_id = ?, message = ?, type = ?, content_type = ?, content_name = ?, media_duration = ?,created = ?', [data.from_id, data.to_id, data.message, data.type, data.content_type, data.content_name, data.media_duration, currentTime], function (errIn, resultsIn) {
                if (!errIn) {
                    var messageId = resultsIn.insertId;
                    data.id = messageId;
                    db.query('SELECT `gu`.`user_id`, `gp`.`id`,`gp`.`name`, IF(`gp`.`image` = "",`gp`.`image`,CONCAT("/uploads/groups/",`gp`.`image`)) AS `image` FROM `group_users` AS `gu` LEFT JOIN `groups` AS `gp` ON `gu`.`group_id` = `gp`.`id` WHERE `gu`.`group_id` = ? AND `gu`.`status` = 1', [data.to_id], function (err, results) {
                        if (!err) {
                            var countQuery = [];
                            var allUsers = _.map(results, function (gU) {
                                return parseInt(gU.user_id);
                            });
                            var resultsData = results;
                            db.query("SELECT * FROM `mute_info` WHERE `to_id` = ? AND `from_id` IN (" + allUsers.join(', ') + ") AND `type` = ? AND status = '1'", [data.to_id, data.type], function (gmErr, gMResult) {
                                var mutedUsers = [];
                                if (!gmErr) {
                                    mutedUsers = _.map(gMResult, function (gMVal) {
                                        return parseInt(gMVal.from_id);
                                    });
                                }
                                _.each(resultsData, function (val) {
                                    var user_id = parseInt(val.user_id);
                                    data.is_muted = 0;
                                    if (mutedUsers.indexOf(user_id) !== -1) {
                                        data.is_muted = 1;
                                    }
                                    if (user_id !== parseInt(data.from_id)) {
                                        countQuery.push(' (' + messageId + ',' + data.from_id + ',' + user_id + ') ');
                                    }
                                    data.group_id = val.id;
                                    data.group_name = val.name;
                                    data.group_image = val.image;
                                    let clients = _.filter(self.clients, function (val) {
                                        return (parseInt(val.user.id) === parseInt(user_id));
                                    });
                                    //console.log(clients);
                                    _.each(clients, function (val) {
                                        try {
                                            data.its_you = 'NO';
                                            if (val.socket === ws) {
                                                data.its_you = 'YES';
                                            }
                                            if(typeof val.user.fcm_token !== 'undefined' && val.user.fcm_token === 'web') {
                                                data.created = utilityHelper.timeZoneChange(currentTime, config.get('timezone'));
                                            }
                                            val.socket.send(JSON.stringify(data));
                                        } catch (err) {
                                            // console.log('Push Error');
                                            // console.log(err);
                                        }

                                    });
                                });
                                db.query('INSERT INTO `chat_read_group_count` (`message_id`,`from_id`,`to_id`) VALUES ' + countQuery.join(','), function (err, result) {
                                    if (err) {
                                        console.log(err);
                                    }
                                });
                            });
                        }
                    });
                }
            });
        }
    },
    typing: function (self, data, ws) {
        data.command = 'typing';
        if (data.type === 'one') {
            let clients = _.filter(self.clients, function (val) {
                return parseInt(val.user.id) === parseInt(data.to_id);
            });
            _.each(clients, function (val) {
                val.socket.send(JSON.stringify(data));
            });
        } else {
            db.query('SELECT `user_id` FROM group_users WHERE group_id = ? AND status = 1', [data.to_id], function (err, results) {
                if (!err) {
                    _.each(results, function (val) {
                        var user_id = parseInt(val.user_id);
                        let clients = _.filter(self.clients, function (val) {
                            return (parseInt(val.user.id) === parseInt(user_id));
                        });
                        _.each(clients, function (val) {
                            if (ws !== val.socket) {
                                val.socket.send(JSON.stringify(data));
                            }
                        });
                    });
                }
            });
        }
    },
    removeClinet: function (ws) {
        var self = this;
        self.statusSend(self, ws, 'offline');
        for (i = 0; i < self.clients.length; i++) {
            if (self.clients[i].socket === ws) {
                delete self.clients[i];
            }
        }
        self.clients = self.clients.filter(function (e) {
            return e;
        });
    },
    statusSend: function (self, ws, type) {
        var data = {};
        data.command = 'onlineStatus';
        data.status = type;
        var clientUserDataArr = _.filter(self.clients, function (val) {
            return val.socket === ws;
        });
        if (clientUserDataArr.length) {
            var clientUserData = clientUserDataArr[0].user;
            data.user_id = clientUserData.id;
            _.each(self.clients, function (val) {
                if (val.socket !== ws) {
                    val.socket.send(JSON.stringify(data), function (error) {
                        console.log(error);
                    });
                }
            });
        }
        if (type === 'online') {
            _.each(self.clients, function (val) {
                if (val.socket !== ws) {
                    data.user_id = val.user.id;
                    ws.send(JSON.stringify(data), function (error) {
                        console.log(error);
                    });
                }
            });
        }
    },
    onlineStatus: function (self, data, ws) {
        data.command = 'onlineStatus';
        data.status = 'online';
        _.each(self.clients, function (val) {
            if (val.socket !== ws) {
                data.user_id = val.user.id;
                ws.send(JSON.stringify(data));
            }
        });
    },
    newGroupNotify: function (group_id) {
        var self = this;
        var socketPushData = {};
        socketPushData.command = 'NewGroup';
        db.query('SELECT * FROM groups WHERE id = "' + group_id + '"', function (err, result) {
            if (!err) {
                var groupData = result[0];
                socketPushData.id = groupData.id;
                socketPushData.name = groupData.name;
                socketPushData.created_by = groupData.user_id;
                socketPushData.image = (groupData.image === '' ? '' : '/uploads/groups/' + groupData.image);
                db.query('SELECT `gu`.`user_id`, `ou`.`name` AS `sent_by`, DATE_FORMAT(`gp`.`created`,"' + config.get('DATE_FORMAT') + '") AS `created` FROM `group_users` AS `gu` LEFT JOIN `groups` AS `gp` ON `gu`.`group_id` = `gp`.`id` LEFT JOIN `users` AS `ou` ON `gp`.`user_id` = `ou`.`id` WHERE `gu`.`group_id` = "' + group_id + '"', function (err, results) {
                    if (!err) {
                        _.each(results, function (val) {
                            var user_id = val.user_id;
                            socketPushData.user_id = val.user_id;
                            socketPushData.sent_by = val.sent_by;
                            socketPushData.created = val.created;
                            let clients = _.filter(self.clients, function (val) {
                                return parseInt(val.user.id) === parseInt(user_id);
                            });
                            if (clients.length) {
                                clients[0].socket.send(JSON.stringify(socketPushData));
                            } else {
                                db.query('SELECT * FROM users_login WHERE user_id = ? AND is_loggedin = "1" GROUP BY `fcm_token`', [user_id], function (errN, resultsN) {
                                    if (!errN) {
                                        _.each(resultsN, function (valN) {
                                            if (parseInt(valN.deviceId) === 3) {
                                                var message = socketPushData;
                                                message.to = valN.fcm_token;
                                            } else {
                                                var message = {
                                                    to: valN.fcm_token,
                                                    data: socketPushData
                                                };
                                            }
                                            notification.sendNotification(message);
                                        });
                                    }
                                });
                            }
                        });
                    }
                });
            }
        });
    },
    editGroupNotify: function (group_id) {
        var self = this;
        var socketPushData = {};
        socketPushData.command = 'EditGroup';
        db.query('SELECT * FROM groups WHERE id = "' + group_id + '"', function (err, result) {
            if (!err) {
                var groupData = result[0];
                socketPushData.id = groupData.id;
                socketPushData.name = groupData.name;
                socketPushData.created_by = groupData.user_id;
                socketPushData.image = (groupData.image === '' ? '' : '/uploads/groups/' + groupData.image);
                db.query('SELECT `gu`.`user_id`, `ou`.`name` AS `sent_by`, DATE_FORMAT(`gp`.`created`,"' + config.get('DATE_FORMAT') + '") AS `created` FROM `group_users` AS `gu` LEFT JOIN `groups` AS `gp` ON `gu`.`group_id` = `gp`.`id` LEFT JOIN `users` AS `ou` ON `gp`.`user_id` = `ou`.`id` WHERE `gu`.`group_id` = "' + group_id + '"', function (err, results) {
                    if (!err) {
                        _.each(results, function (val) {
                            var user_id = val.user_id;
                            socketPushData.user_id = val.user_id;
                            socketPushData.sent_by = val.sent_by;
                            socketPushData.created = val.created;
                            let clients = _.filter(self.clients, function (val) {
                                return parseInt(val.user.id) === parseInt(user_id);
                            });
                            if (clients.length) {
                                clients[0].socket.send(JSON.stringify(socketPushData));
                            } else {
                                db.query('SELECT * FROM users_login WHERE user_id = ? AND is_loggedin = "1" GROUP BY `fcm_token`', [user_id], function (errN, resultsN) {
                                    if (!errN) {
                                        _.each(resultsN, function (valN) {
                                            if (parseInt(valN.deviceId) === 3) {
                                                var message = socketPushData;
                                                message.to = valN.fcm_token;
                                            } else {
                                                var message = {
                                                    to: valN.fcm_token,
                                                    data: socketPushData
                                                };
                                            }
                                            notification.sendNotification(message);
                                        });
                                    }
                                });
                            }
                        });
                    }
                });
            }
        });
    },
    newGroupUsersNotify: function (group_id, new_users_to_add) {
        var self = this;
        var socketPushData = {};
        socketPushData.command = 'NewGroup';
        db.query('SELECT * FROM groups WHERE id = "' + group_id + '"', function (err, result) {
            if (!err) {
                var groupData = result[0];
                socketPushData.id = groupData.id;
                socketPushData.name = groupData.name;
                socketPushData.created_by = groupData.user_id;
                socketPushData.image = (groupData.image === '' ? '' : '/uploads/groups/' + groupData.image);
                db.query('SELECT `gu`.`user_id`, `ou`.`name` AS `sent_by`, DATE_FORMAT(`gp`.`created`,"' + config.get('DATE_FORMAT') + '") AS `created` FROM `group_users` AS `gu` LEFT JOIN `groups` AS `gp` ON `gu`.`group_id` = `gp`.`id` LEFT JOIN `users` AS `ou` ON `gp`.`user_id` = `ou`.`id` WHERE `gu`.`group_id` = "' + group_id + '" AND `gu`.`user_id` IN(' + new_users_to_add.join(', ') + ')', function (err, results) {
                    if (!err) {
                        _.each(results, function (val) {
                            var user_id = val.user_id;
                            socketPushData.user_id = val.user_id;
                            socketPushData.sent_by = val.sent_by;
                            socketPushData.created = val.created;
                            let clients = _.filter(self.clients, function (val) {
                                return parseInt(val.user.id) === parseInt(user_id);
                            });
                            if (clients.length) {
                                clients[0].socket.send(JSON.stringify(socketPushData));
                            } else {
                                db.query('SELECT * FROM users_login WHERE user_id = ? AND is_loggedin = "1" GROUP BY `fcm_token`', [user_id], function (errN, resultsN) {
                                    if (!errN) {
                                        _.each(resultsN, function (valN) {
                                            if (parseInt(valN.deviceId) === 3) {
                                                var message = socketPushData;
                                                message.to = valN.fcm_token;
                                            } else {
                                                var message = {
                                                    to: valN.fcm_token,
                                                    data: socketPushData
                                                };
                                            }
                                            notification.sendNotification(message);
                                        });
                                    }
                                });
                            }
                        });
                    } else {
                        console.log(err);
                    }
                });
            }
        });
    },
    blockUnblockNotify: function (user_id, to_id, status) {
        var self = this;
        var socketPushData = {};
        socketPushData.command = 'block_unblock';
        socketPushData.user_id = parseInt(user_id);
        socketPushData.to_id = parseInt(to_id);
        socketPushData.status = status;
        socketPushData.blocked_by = "";
        let clients = _.filter(self.clients, function (val) {
            return (parseInt(val.user.id) === parseInt(user_id)) || (parseInt(val.user.id) === parseInt(to_id));
        });
        db.query('SELECT `name` FROM `users` WHERE `id` = ?', [user_id], function (errB, resultB) {
            if (!errB) {
                if (resultB.length) {
                    socketPushData.blocked_by = resultB[0].name;
                    _.each(clients, function (val) {
                        val.socket.send(JSON.stringify(socketPushData));
                    });
                }
            }
        });
    },
    notifyGroupUserDelete: function (group_id, deleted_users) {
        var self = this;
        var socketPushData = {};
        socketPushData.command = 'delete_from_group';
        socketPushData.group_id = group_id;
        _.each(deleted_users, function (val) {
            socketPushData.user_id = val;
            var client = _.filter(self.clients, function (client) {
                return parseInt(client.user.id) === parseInt(val);
            });
            _.each(client, function (clientVal) {
                clientVal.socket.send(JSON.stringify(socketPushData));
            });
        });
    },
    read_receipt: function (self, data, ws) {
        var type = data.type;
        var user_id = data.user_id;
        var to_id = data.to_id;
        var socketPushData = {};
        socketPushData.command = 'read_receipt';
        socketPushData.type = type;
        socketPushData.user_id = user_id;
        socketPushData.to_id = to_id;
        if (type === 'one') {
            socketPushData.is_read = 1;
            //console.log(db.query('UPDATE `chat` SET `read_status` = 1 WHERE `from_id` = ? AND `to_id` = ? AND `type` = "one"',[to_id,user_id]));
            db.query('UPDATE `chat` SET `read_status` = 1 WHERE `from_id` = ? AND `to_id` = ? AND `type` = "one"', [to_id, user_id], function (err, result) {
                //console.log(err);
                // console.log(result);
            });
            var client = _.filter(self.clients, function (client) {
                return parseInt(client.user.id) === parseInt(to_id);
            });
            _.each(client, function (clientVal) {
                clientVal.socket.send(JSON.stringify(socketPushData));
            });
        } else {
            db.query('UPDATE `chat` AS `ac` INNER JOIN `chat_read_group_count` AS `crgc` ON `ac`.`id` = `crgc`.`message_id` AND `crgc`.`to_id` = ? SET `crgc`.`status` = 1 WHERE `ac`.`type` = "two" AND `ac`.`to_id` = ?', [user_id, to_id], function (err, result) {
                db.query('SELECT GROUP_CONCAT(`user_id`) AS `users_list` FROM `group_users` WHERE `group_id` = ? AND is_deleted = "0" GROUP BY `group_id`', [to_id], function (gcErr, gcResult) {
                    var groupUsers = '';
                    if (!gcErr) {
                        if (gcResult.length) {
                            groupUsers = gcResult[0].users_list;
                        }
                    }
                    db.query('SELECT IF(COUNT(`is_read1`) = SUM(`is_read1`),1,0) AS `is_read` FROM `chat` AS `ac` INNER JOIN (SELECT *, IF(COUNT(`status`) = SUM(`status`),1,0) AS `is_read1` FROM `chat_read_group_count` WHERE `from_id` IN (' + groupUsers + ') AND `to_id` IN (' + groupUsers + ') GROUP BY `message_id`) `tbl` ON `ac`.`id` = `tbl`.`message_id` WHERE `ac`.`to_id` = ?', [to_id], function (errR, resultR) {
                        socketPushData.is_read = 0;
                        if (!errR) {
                            if (resultR.length) {
                                socketPushData.is_read = resultR[0].is_read;
                                if (data.id) {
                                    db.query('SELECT * FROM `chat` WHERE id = ?', [data.id], function (errC, resultC) {
                                        if (!errC) {
                                            if (resultC.length) {
                                                var client = _.filter(self.clients, function (client) {
                                                    return parseInt(client.user.id) === parseInt(resultC[0].from_id);
                                                });
                                                _.each(client, function (clientVal) {
                                                    clientVal.socket.send(JSON.stringify(socketPushData));
                                                });
                                            }
                                        }
                                    });
                                }
                            }
                        }
                    });
                });
            });
        }
    },
    logout: function (user_id) {
        var data = {};
        data.command = 'loggedout';
        data.is_loggedOut = 1;
        var clients = _.filter(ChatHelper.clients, function (obj) {
            return parseInt(obj.user.id) === parseInt(user_id);
        });
        _.each(clients, function (clientVal) {
            ChatHelper.statusSend(ChatHelper, clientVal.socket, 'offline');
        });
    },
    start_call: function (self, data, ws) {
        var socketPushData = data;
        socketPushData.command = 'incoming_call';
        var user = _.filter(self.clients, function (obj) {
            return obj.socket === ws;
        });
        socketPushData.name = user[0].user.name;
        socketPushData.image_url = user[0].user.image_url;
        if (data.type === 'one') {
            var client = _.filter(self.clients, function (obj) {
                return parseInt(obj.user.id) === parseInt(data.to_id);
            });
            if (client.length) {
                _.each(client, function (clientVal) {
                    clientVal.socket.send(JSON.stringify(socketPushData));
                });
            } else {
                db.query("SELECT `au`.*, `aul`.`deviceId`, `aul`.`fcm_token` FROM `users_login` AS `aul` INNER JOIN (SELECT MAX(`id`) AS `mid` FROM `users_login`  WHERE `is_loggedin` = '1' GROUP BY `user_id`) gtbl ON `aul`.`id` = `gtbl`.`mid` LEFT JOIN `users` AS `au` ON `aul`.`user_id` = `au`.`id` WHERE `aul`.`user_id` IN (" + parseInt(data.to_id) + ")", function (offErr, offResult) {
                    if (!offErr) {
                        if (offResult.length) {
                            _.each(offResult, function (offVal) {
                                if (parseInt(offVal.deviceId) === 3) {
                                    var message = socketPushData;
                                    message.to = offVal.fcm_token;
                                } else {
                                    var message = {
                                        to: offVal.fcm_token,
                                        data: socketPushData
                                    };
                                }
                                notification.sendNotification(message);
                            });
                        } else {
                            socketPushData.command = 'user_offline';
                            user[0].socket.send(JSON.stringify(socketPushData));
                        }
                    } else {
                        socketPushData.command = 'user_offline';
                        user[0].socket.send(JSON.stringify(socketPushData));
                    }
                });
            }
        } else {
            db.query("SELECT `user_id` FROM `group_users` WHERE `group_id` = ? AND `status` = 1 AND `is_deleted` = '0' AND `user_id` != ?", [data.to_id, data.user_id], function (err, result) {
                if (!err) {
                    var onlineUsers = [];
                    var offlineUsers = [];
                    _.each(result, function (val) {
                        var client = _.filter(self.clients, function (obj) {
                            return parseInt(obj.user.id) === parseInt(val.user_id);
                        });
                        if (!client.length) {
                            offlineUsers.push(val.user_id);
                        } else {
                            onlineUsers.push(client[0]);
                        }
                    });
                    if (offlineUsers.length) {
                        db.query("SELECT `au`.*, `aul`.`deviceId`, `aul`.`fcm_token` FROM `users_login` AS `aul` INNER JOIN (SELECT MAX(`id`) AS `mid` FROM `users_login`  WHERE `is_loggedin` = '1' GROUP BY `user_id`) gtbl ON `aul`.`id` = `gtbl`.`mid` LEFT JOIN `users` AS `au` ON `aul`.`user_id` = `au`.`id` WHERE `aul`.`user_id` IN (" + offlineUsers.join(', ') + ")", function (offErr, offResult) {
                            var allOnlineUsers = [];
                            if (!offErr) {
                                _.each(offResult, function (offVal) {
                                    allOnlineUsers.push({id: offVal.id, name: offVal.name, image_url: offVal.image_url});
                                });
//                                _.each(offResult,function(offVal){
//                                    if(parseInt(offVal.deviceId) === 3) {
//                                        var message = socketPushData;
//                                        message.to = offVal.fcm_token;
//                                    } else {
//                                        var message = {
//                                            to: offVal.fcm_token,
//                                            data: socketPushData
//                                        };
//                                    }
//                                    notification.sendNotification(message);
//                                });
                            }
                            if (onlineUsers.length) {
                                _.each(onlineUsers, function (onlineUser) {
                                    allOnlineUsers.push({id: onlineUser.user.id, name: onlineUser.user.name, image_url: onlineUser.user.image_url});
                                });
                            }
                            if (allOnlineUsers.length) {
                                socketPushData.command = 'group_call_response';
                                socketPushData.onlineUsers = allOnlineUsers;
                                user[0].socket.send(JSON.stringify(socketPushData));
                            } else {
                                socketPushData.command = 'user_offline';
                                user[0].socket.send(JSON.stringify(socketPushData));
                            }
                        });
                    } else if (onlineUsers.length) {
                        var allOnlineUsers = [];
                        _.each(onlineUsers, function (onlineUser) {
                            allOnlineUsers.push({id: onlineUser.user.id, name: onlineUser.user.name, image_url: onlineUser.user.image_url});
                        });
                        socketPushData.command = 'group_call_response';
                        socketPushData.onlineUsers = allOnlineUsers;
                        user[0].socket.send(JSON.stringify(socketPushData));
                    } else {
                        socketPushData.command = 'user_offline';
                        user[0].socket.send(JSON.stringify(socketPushData));
                    }
                }
            });
        }
    },
    start_group_call: function (self, data, ws) {
        var socketPushData = data;
        socketPushData.command = 'incoming_call';
        var user = _.filter(self.clients, function (obj) {
            return obj.socket === ws;
        });
        socketPushData.name = user[0].user.name;
        socketPushData.image_url = user[0].user.image_url;
        var client = _.filter(self.clients, function (obj) {
            return parseInt(obj.user.id) === parseInt(data.to_id);
        });
        if (client.length) {
            _.each(client, function (clientVal) {
                clientVal.socket.send(JSON.stringify(socketPushData));
            });
        } else {
            db.query("SELECT `au`.*, `aul`.`deviceId`, `aul`.`fcm_token` FROM `users_login` AS `aul` INNER JOIN (SELECT MAX(`id`) AS `mid` FROM `users_login`  WHERE `is_loggedin` = '1' GROUP BY `user_id`) gtbl ON `aul`.`id` = `gtbl`.`mid` LEFT JOIN `users` AS `au` ON `aul`.`user_id` = `au`.`id` WHERE `aul`.`user_id` IN (" + parseInt(data.to_id) + ")", function (offErr, offResult) {
                if (!offErr) {
                    if (offResult.length) {
                        _.each(offResult, function (offVal) {
                            if (parseInt(offVal.deviceId) === 3) {
                                var message = socketPushData;
                                message.to = offVal.fcm_token;
                            } else {
                                var message = {
                                    to: offVal.fcm_token,
                                    data: socketPushData
                                };
                            }
                            notification.sendNotification(message);
                        });
                    } else {
                        socketPushData.command = 'user_offline';
                        user[0].socket.send(JSON.stringify(socketPushData));
                    }
                } else {
                    socketPushData.command = 'user_offline';
                    user[0].socket.send(JSON.stringify(socketPushData));
                }
            });
        }
    },
    call_accepted: function (self, data, ws) {
        var socketPushData = data;
        socketPushData.command = 'call_accepted';
        var client = _.filter(self.clients, function (obj) {
            return parseInt(obj.user.id) === parseInt(data.to_id);
        });
        var user = _.filter(self.clients, function (obj) {
            return obj.socket === ws;
        });
        socketPushData.name = user[0].user.name;
        socketPushData.image_url = user[0].user.image_url;
        if (client.length) {
            _.each(client, function (clientVal) {
                clientVal.socket.send(JSON.stringify(socketPushData));
            });
        }
    },
    call_rejected: function (self, data, ws) {
        var socketPushData = data;
        socketPushData.command = 'call_rejected';
        var client = _.filter(self.clients, function (obj) {
            return parseInt(obj.user.id) === parseInt(data.to_id);
        });
        var user = _.filter(self.clients, function (obj) {
            return obj.socket === ws;
        });
        socketPushData.name = user[0].user.name;
        socketPushData.image_url = user[0].user.image_url;
        if (client.length) {
            _.each(client, function (clientVal) {
                clientVal.socket.send(JSON.stringify(socketPushData));
            });
        }
    },
    offer: function (self, data, ws) {
        var to_id = parseInt(data.to_id);
        var user_id = parseInt(data.user_id);
        var socketPushData = data;
        socketPushData.command = 'offer';
        socketPushData.stream = data.stream;
        var client = _.filter(self.clients, function (obj) {
            return parseInt(obj.user.id) === to_id;
        });
        var user = _.filter(self.clients, function (obj) {
            return obj.socket === ws;
        });
        socketPushData.name = user[0].user.name;
        socketPushData.image_url = user[0].user.image_url;
        if (client.length) {
            _.each(client, function (clientVal) {
                clientVal.socket.send(JSON.stringify(socketPushData));
            });
        }
    },
    call_answer: function (self, data, ws) {
        var to_id = parseInt(data.to_id);
        var user_id = parseInt(data.user_id);
        var socketPushData = data;
        socketPushData.command = 'call_answer';
        socketPushData.stream = data.stream;
        var client = _.filter(self.clients, function (obj) {
            return parseInt(obj.user.id) === to_id;
        });
        var user = _.filter(self.clients, function (obj) {
            return obj.socket === ws;
        });
        //console.log(client);
        //console.log("here at answer");
        socketPushData.name = user[0].user.name;
        socketPushData.image_url = user[0].user.image_url;
        if (client.length) {
            _.each(client, function (clientVal) {
                clientVal.socket.send(JSON.stringify(socketPushData));
            });
        }
    },
    candidate: function (self, data, ws) {
        var to_id = parseInt(data.to_id);
        var user_id = parseInt(data.user_id);
        var socketPushData = data;
        socketPushData.command = 'candidate';
        socketPushData.stream = data.stream;
        var client = _.filter(self.clients, function (obj) {
            return parseInt(obj.user.id) === to_id;
        });
        var user = _.filter(self.clients, function (obj) {
            return obj.socket === ws;
        });
        socketPushData.name = user[0].user.name;
        socketPushData.image_url = user[0].user.image_url;
        if (client.length) {
            _.each(client, function (clientVal) {
                clientVal.socket.send(JSON.stringify(socketPushData));
            });
        }
    },
    call_ended: function (self, data, ws) {
        var socketPushData = data;
        socketPushData.command = 'call_ended';
        var client = _.filter(self.clients, function (obj) {
            return parseInt(obj.user.id) === parseInt(data.to_id);
        });
        var user = _.filter(self.clients, function (obj) {
            return obj.socket === ws;
        });
        socketPushData.name = user[0].user.name;
        socketPushData.image_url = user[0].user.image_url;
        if (client.length) {
            _.each(client, function (clientVal) {
                clientVal.socket.send(JSON.stringify(socketPushData));
            });
        }
    },
    group_call_received: function (self, data, ws) {
        var receiver = parseInt(data.receiver);
        var group_id = parseInt(data.group_id);
        db.query("SELECT `user_id` FROM `group_users` WHERE `group_id` = ? AND `status` = 1 AND `is_deleted` = '0' AND `user_id` != ?", [group_id, receiver], function (err, result) {
            if (!err) {
                _.each(result, function (val) {
                    var client = _.filter(self.clients, function (obj) {
                        return parseInt(obj.user.id) === parseInt(val.user_id);
                    });
                    if(client.length) {
                        client[0].socket.send(JSON.stringify({ command: 'group_call_received', group_id: group_id, receiver: receiver, call_type: data.call_type }));
                    }
                });
            }
        });
    },
    group_call_ended: function(self, data, ws) {
        let socketPushData = data;
        socketPushData.command = 'group_call_ended';
        let to_id = data.to_id;
        let user_id = data.user_id;
        socketPushData.ended_by = user_id;
        db.query("SELECT `ag`.`id`,`ag`.`name`,`ag`.`image`,CONCAT('[',GROUP_CONCAT('{\"user_id\": \"',`agu`.`user_id`,'\"}'),']') AS `users_list` FROM `group_users` AS `agu` LEFT JOIN `groups` AS `ag` ON `agu`.`group_id` = `ag`.`id` WHERE `agu`.`status` = 1 AND `agu`.`is_deleted` = '0' AND `ag`.`id` = ? AND `agu`.`user_id` != ? GROUP BY `agu`.`group_id`",[to_id,user_id],function(err, result){
            if(!err) {
                if(result.length) {
                    socketPushData.name = result[0].name;
                    let usersList = JSON.parse(result[0].users_list);
                    let userlistArr = _.map(usersList,function(obj){
                        return parseInt(obj.user_id);
                    });
                    _.each(userlistArr,function(val){
                        var client = _.filter(self.clients, function (obj) {
                            return parseInt(obj.user.id) === val;
                        });
                        if(client.length) {
                            client[0].socket.send(JSON.stringify(socketPushData));
                        }
                    });
                }
            }
        });
    }
};
module.exports = ChatHelper;