var db = require('../database/database');
var async = require('async');
var dateFormat = require('dateformat');
var chatHelper = require('../helpers/ChatHelper');
var randomString = require('random-string');
var ffmpeg = require('fluent-ffmpeg');
var path = require('path');
var config = require('config');
var _ = require('underscore');
var utilityHelper = require('../helpers/Utility');
var ChatController = {
    getChats: function (req, res, next) {
        if (typeof req.session.userData === 'undefined') {
            res.redirect('/restricted');
            return true;
        }
        var userData = req.session.userData;
        userData.fcm_token = 'web';
        userData.device_type = 10;
        async.waterfall([
            function (callback) {
                db.query('SELECT GROUP_CONCAT(group_id) AS `gList` FROM group_users WHERE user_id = ? GROUP BY user_id', [userData.id], function (err, results) {
                    if (err) {
                        callback('Error', 'Something went wrong on the server. Please try again!');
                    } else {
                        if (results.length) {
                            callback(null, results[0].gList);
                        } else {
                            callback(null, false);
                        }
                    }
                });
            },
            function (groups, callback) {
                let inQuery = '';
                if (groups) {
                    inQuery = '  OR `to_id` IN(' + groups + ') ';
                }
                db.query('SELECT `tbl1`.`other_user_id` AS `id`, IF(`tbl1`.`type` = "one",IF(`counter_table`.`read_count` IS NULL,0,`counter_table`.`read_count`),`counter_table1`.`read_count`) AS `unread` ,IF(`ag`.`existed` IS NULL,0,`ag`.`existed`) AS `existed`, IF(`tbl1`.`type` = "one",`au`.`name`,`ag`.`name`) AS `name`, IF(`tbl1`.`type` = "one",`au`.`email`,"") AS `email`,IF(`tbl1`.`type` = "one",`au`.`image_url`,IF(`ag`.`image` = "",`ag`.`image`,CONCAT("/uploads/groups/",`ag`.`image`))) AS `image_url`, `tbl1`.`type`, `tbl1`.`media_duration`, `tbl1`.`content_type`,REPLACE(`tbl1`.`message`,"\n"," ") AS `message`, `tbl1`.`ukey`,`tbl1`.`created`, IF(`tblB`.`id` IS NOT NULL,"1","0") AS `is_blocked`, IF(`tblB`.`blocked_by_id` IS NOT NULL,`tblB`.`blocked_by_id`,"") AS `blocked_by_id`, IF(`tblB`.`blocked_by` IS NOT NULL,`tblB`.`blocked_by`,"") AS `blocked_by` FROM (SELECT  *, IF( `type` = "two", `to_id`,IF( `to_id` =  ?, `from_id`, `to_id`)) AS `other_user_id`, CONCAT(IF( `type` = "two", `to_id`,IF( `to_id` =  ?, `from_id`, `to_id`)),"-", `type`) AS `uKey` FROM `chat` WHERE  `from_id` =  ? OR  `to_id` =  ? ' + inQuery + ') tbl1 INNER JOIN (SELECT MAX(`id`) AS `id`, CONCAT(IF( `type` = "two", `to_id`,IF( `to_id` =  ?, `from_id`, `to_id`)),"-", `type`) AS `uKey` FROM `chat` WHERE  `from_id` =  ? OR  `to_id` =  ? ' + inQuery + ' GROUP BY `uKey`) tbl2 ON `tbl1`.`id` = `tbl2`.`id` LEFT JOIN `users` AS `au` ON `tbl1`.`other_user_id` = `au`.`id` AND `tbl1`.`type` = "one" LEFT JOIN ( SELECT `groups`.*, `group_users`.`is_deleted`, `group_users`.`existed` FROM `groups` LEFT JOIN `group_users` ON `groups`.`id` = `group_users`.`group_id` WHERE `group_users`.`user_id` =  ? AND `group_users`.`status` != 2 ) AS `ag` ON `tbl1`.`other_user_id` = `ag`.`id` AND `tbl1`.`type` = "two" AND `ag`.`is_deleted` = "0" LEFT JOIN (SELECT `aub`.`id`,`aub`.`from_id` AS `blocked_by_id`, `auf`.`name` AS `blocked_by` , IF(`aub`.`to_id` = ?, `aub`.`from_id`, `aub`.`to_id`) AS `user_id` FROM `users_blocked` AS `aub` LEFT JOIN `users` AS `auf` ON `aub`.`from_id` = `auf`.`id` WHERE (`from_id` = ? OR `to_id` = ?) AND `status` = "1" GROUP BY `status`) tblB ON `tblB`.`user_id`  = `tbl1`.`other_user_id` LEFT JOIN (SELECT *,SUM(IF(`read_status` = 0,1,0)) AS `read_count` FROM chat WHERE `type` = "one" AND `to_id` = ? GROUP BY `from_id`, `to_id`) `counter_table` ON `tbl1`.`other_user_id` = `counter_table`.`from_id` AND `tbl1`.`type` = "one" LEFT JOIN (SELECT `cc`.*,`ccr`.`status`, SUM(IF(`ccr`.`status` = 1 OR `ccr`.`status` IS NULL,0,1)) AS `read_count` FROM `chat` AS `cc`  LEFT JOIN ( SELECT * FROM chat_read_group_count WHERE `to_id` = ?) AS `ccr` ON `cc`.`id` = `ccr`.`message_id` WHERE `cc`.`type` = "two" AND `cc`.`from_id` != ? GROUP BY `cc`.`to_id` ORDER BY `cc`.`id` DESC) `counter_table1` ON `tbl1`.`other_user_id` = `counter_table1`.`to_id` AND `tbl1`.`type` = "two" WHERE `tbl1`.`ukey` != ? HAVING `name` IS NOT NULL ORDER BY `tbl1`.`created` DESC', [userData.id, userData.id, userData.id, userData.id, userData.id, userData.id, userData.id, userData.id, userData.id, userData.id, userData.id, userData.id, userData.id, userData.id, userData.id + '-one'], function (err, results) {
                    if (err) {
                        callback('Error', 'Something went wrong on the server. Please try again!');
                    } else {
                        var response = _.map(results, function (val) {
                            val.message = val.message.replace(/(\r\n\t|\n|\r\t)/gm, "");
                            val.message = val.message.replace(/"/g, '“');
                            return val;
                        });
                        callback(null, response);
                    }
                });
            }
        ], function (err, data) {
            //console.log(req.session.userData);
            res.render('index', {title: userData.name, data: {userData: userData, users: data}});
        });
    },
    getChatsAPI: function (req, res, next) {
        async.waterfall([
            function (callback) {
                if (typeof req.body.user_id !== 'undefined' && (req.body.user_id).trim()) {
                    if (typeof req.body.page === 'undefined' || !(req.body.page).trim() || parseInt(req.body.page) < 1) {
                        req.body.page = 1;
                    }
                    callback(null, req.body.user_id);
                } else {
                    callback('error', {error: 1, message: 'Required fields are missing'});
                }
            },
            function (user_id, callback) {
                db.query('SELECT GROUP_CONCAT(group_id) AS `gList` FROM group_users WHERE user_id = ? GROUP BY user_id', [user_id], function (err, results) {
                    if (err) {
                        callback('Error', {error: 1, message: 'Something went wrong on the server. Please try again!'});
                    } else {
                        if (results.length) {
                            callback(null, user_id, results[0].gList);
                        } else {
                            callback(null, user_id, false);
                        }
                    }
                });
            },
            function (user_id, groups, callback) {
                let inQuery = '';
                if (groups) {
                    inQuery = '  OR `to_id` IN(' + groups + ') ';
                }
                let offset = (parseInt(req.body.page) - 1) * config.get('limit');
                db.query('SELECT `tbl1`.`other_user_id` AS `id`, IF(`tbl1`.`type` = "one",IF(`counter_table`.`read_count` IS NULL,0,`counter_table`.`read_count`),`counter_table1`.`read_count`) AS `unread`,IF(`ag`.`existed` IS NULL,0,`ag`.`existed`) AS `existed`,IF(`tbl1`.`type` = "one",`au`.`name`,`ag`.`name`) AS `name`, IF(`tbl1`.`type` = "one",`au`.`email`,"") AS `email`,IF(`tbl1`.`type` = "one",`au`.`image_url`,IF(`ag`.`image` = "",`ag`.`image`,CONCAT("/uploads/groups/",`ag`.`image`))) AS `image_url`, `tbl1`.`type`, `tbl1`.`media_duration`, `tbl1`.`content_type`, `tbl1`.`message`,`tbl1`.`ukey`,DATE_FORMAT(`tbl1`.`created`,"' + config.get('DATE_FORMAT') + '") AS `created`, IF(`tblB`.`id` IS NOT NULL,"1","0") AS `is_blocked`, IF(`tblB`.`blocked_by_id` IS NOT NULL,`tblB`.`blocked_by_id`,"") AS `blocked_by_id`, IF(`tblB`.`blocked_by` IS NOT NULL,`tblB`.`blocked_by`,"") AS `blocked_by` FROM (SELECT  *, IF( `type` = "two", `to_id`,IF( `to_id` =  ?, `from_id`, `to_id`)) AS `other_user_id`, CONCAT(IF( `type` = "two", `to_id`,IF( `to_id` =  ?, `from_id`, `to_id`)),"-", `type`) AS `uKey` FROM `chat` WHERE  `from_id` =  ? OR  `to_id` =  ? ' + inQuery + ') tbl1 INNER JOIN (SELECT MAX(`id`) AS `id`, CONCAT(IF( `type` = "two", `to_id`,IF( `to_id` =  ?, `from_id`, `to_id`)),"-", `type`) AS `uKey` FROM `chat` WHERE  `from_id` =  ? OR  `to_id` =  ? ' + inQuery + ' GROUP BY `uKey`) tbl2 ON `tbl1`.`id` = `tbl2`.`id` LEFT JOIN `users` AS `au` ON `tbl1`.`other_user_id` = `au`.`id` AND `tbl1`.`type` = "one" LEFT JOIN ( SELECT `groups`.*, `group_users`.`is_deleted`, `group_users`.`existed` FROM `groups` LEFT JOIN `group_users` ON `groups`.`id` = `group_users`.`group_id` WHERE `group_users`.`user_id` =  ? AND `group_users`.`status` = 1 ) AS `ag` ON `tbl1`.`other_user_id` = `ag`.`id` AND `tbl1`.`type` = "two" AND `ag`.`is_deleted` = "0" LEFT JOIN (SELECT `aub`.`id`,`aub`.`from_id` AS `blocked_by_id`, `auf`.`name` AS `blocked_by` , IF(`aub`.`to_id` = ?, `aub`.`from_id`, `aub`.`to_id`) AS `user_id` FROM `users_blocked` AS `aub` LEFT JOIN `users` AS `auf` ON `aub`.`from_id` = `auf`.`id` WHERE (`from_id` = ? OR `to_id` = ?) AND `status` = 1 GROUP BY `status`) tblB ON `tblB`.`user_id`  = `tbl1`.`other_user_id` LEFT JOIN (SELECT *,SUM(IF(`read_status` = 0,1,0)) AS `read_count` FROM chat WHERE `type` = "one" AND `to_id` = ? GROUP BY `from_id`, `to_id`) `counter_table` ON `tbl1`.`other_user_id` = `counter_table`.`from_id` AND `tbl1`.`type` = "one" LEFT JOIN (SELECT `cc`.*,`ccr`.`status`, SUM(IF(`ccr`.`status` = 1 OR `ccr`.`status` IS NULL,0,1)) AS `read_count` FROM `chat` AS `cc`  LEFT JOIN ( SELECT * FROM chat_read_group_count WHERE `to_id` = ?) AS `ccr` ON `cc`.`id` = `ccr`.`message_id` WHERE `cc`.`type` = "two" AND `cc`.`from_id` != ? GROUP BY `cc`.`to_id` ORDER BY `cc`.`id` DESC) `counter_table1` ON `tbl1`.`other_user_id` = `counter_table1`.`to_id` AND `tbl1`.`type` = "two" WHERE `tbl1`.`ukey` != ? HAVING `name` IS NOT NULL ORDER BY `tbl1`.`created` DESC LIMIT ' + offset + ',' + config.get('limit'), [user_id, user_id, user_id, user_id, user_id, user_id, user_id, user_id, user_id, user_id, user_id, user_id, user_id, user_id, user_id + '-one'], function (err, results) {
                    if (err) {
                        console.log(err);
                        callback('Error', {error: 1, message: 'Something went wrong on the server. Please try again!'});
                    } else {
                        callback(null, {error: 0, message: 'Chat Users successfully listed', data: results});
                    }
                });
            }
        ], function (err, data) {
            res.json(data);
        });
    },
    getChatMessages: function (req, res, next) {
        async.waterfall([
            function (callback) {
                let to_id = req.body.id;
                let type = req.body.type;
                let userData = req.session.userData;
                if (typeof userData !== 'undefined') {
                    callback(null, to_id, userData.id, type);
                } else {
                    callback('Error', 'You are not allowed to access this URL');
                }
            },
            function (to_id, user_id, type, callback) {
                if (type === 'one') {
                    db.query('SELECT `gc`.*,`fu`.`name`, `fu`.`image_url` AS `user_image`, `gc`.`read_status` AS `is_read` ,DATE_FORMAT(`gc`.`created`,"' + config.get('DATE_FORMAT') + '") AS `created` FROM `chat` AS `gc` LEFT JOIN `users` AS `fu` ON `gc`.`from_id` = `fu`.`id` WHERE (`gc`.`from_id` = ' + user_id + ' AND `gc`.`to_id` = ' + to_id + ') OR (`gc`.`from_id` = ' + to_id + ' AND `gc`.`to_id` = ' + user_id + ') AND `gc`.`type` = "one" ORDER BY `gc`.`created` DESC LIMIT 0,' + config.get('limit'), function (err, results) {
                        if (err) {
                            callback('Error', 'Somthing went wrong on the server. Please try again!');
                        } else {
                            var resposneData = results.reverse();
                            req.session.userData.to_id = to_id;
                            _.each(resposneData, function (val) {
                                delete val.read_status;
                                val.media_thumbnail = '';
                                val.content_url = '';
                                if (val.content_type === 'video') {
                                    let fileName = val.content_name.split('.').slice(0, -1).join('.');
                                    val.media_thumbnail = '/uploads/thumb/' + fileName + '.png';
                                }
                                if (val.content_type !== 'text') {
                                    val.content_url = '/uploads/' + val.content_name;
                                }
                            });
                            callback(null, resposneData);
                        }
                    });
                } else if (type === 'two') {
                    db.query('SELECT `gc`.*,`fu`.`name`, `fu`.`image_url` AS `user_image`, IF(`crgc`.`is_read` IS NULL,0,`crgc`.`is_read`) AS `is_read`, DATE_FORMAT(`gc`.`created`,"' + config.get('DATE_FORMAT') + '") AS `created` FROM `chat` AS `gc` LEFT JOIN `users` AS `fu` ON `gc`.`from_id` = `fu`.`id` LEFT JOIN (SELECT *, COUNT(`message_id`) AS `total_messages`, SUM(`status`) AS `total_read_messages`, IF(COUNT(`message_id`) = SUM(`status`),1,0) AS `is_read` FROM `chat_read_group_count` WHERE `from_id` = ' + req.session.userData.id + ' GROUP BY `message_id`) AS `crgc` ON `gc`.`id` = `crgc`.`message_id` WHERE `gc`.`to_id` = ' + to_id + ' AND `gc`.`type` = "two" ORDER BY `gc`.`created` DESC LIMIT 0,' + config.get('limit'), function (err, results) {
                        if (err) {
                            callback('Error', 'Somthing went wrong on the server. Please try again!');
                        } else {
                            let resposneData = results.reverse();
                            _.each(resposneData, function (val) {
                                delete val.read_status;
                                val.media_thumbnail = '';
                                val.content_url = '';
                                if (val.content_type === 'video') {
                                    let fileName = val.content_name.split('.').slice(0, -1).join('.');
                                    val.media_thumbnail = '/uploads/thumb/' + fileName + '.png';
                                }
                                if (val.content_type !== 'text') {
                                    val.content_url = '/uploads/' + val.content_name;
                                }
                            });
                            callback(null, resposneData);
                        }
                    });
                } else {
                    callback('Error', 'Invalid type value');
                }
            },
            function (data, callback) {
                if (req.body.type === 'one') {
                    data = _.map(data, function (obj) {
                        obj.created = utilityHelper.timeZoneChange(obj.created, config.get('timezone'));
                        return obj;
                    });
                    callback(null, {data: data});
                } else {
                    db.query('SELECT `gu`.*  FROM `group_users` AS `gu` WHERE `gu`.`user_id` = ? AND `gu`.`group_id` = ?', [req.session.userData.id, req.body.id], function (err, results) {
                        if (!err) {
                            db.query('SELECT `gu`.*, `au`.`name` AS `user_name`, `au`.`email` AS `user_email`, `au`.`image_url` AS `user_image` FROM `group_users` AS `gu` LEFT JOIN `users` AS `au` ON `gu`.`user_id` = `au`.`id` WHERE `gu`.`user_id` != ? AND `gu`.`group_id` = ?', [req.session.userData.id, req.body.id], function (err, groupResults) {
                                if (!err) {
                                    db.query('SELECT `ag`.`name` AS `group_name`, `au`.`name` AS `user_name` FROM `groups` AS `ag` LEFT JOIN `users` AS `au` ON `ag`.`user_id` = `au`.`id` WHERE `ag`.`id` = ?', [req.body.id], function (err, groupData) {
                                        if (!err) {
                                            data = _.map(data, function (obj) {
                                                obj.created = utilityHelper.timeZoneChange(obj.created, config.get('timezone'));
                                                return obj;
                                            });
                                            callback(null, {data: data, info: results[0], group_users: groupResults, group_data: groupData[0]});
                                        } else {
                                            callback(err, 'Something went wrong on the server');
                                        }
                                    });
                                } else {
                                    callback(err, 'Something went wrong on the server');
                                }
                            });
                        } else {
                            callback(err, 'Something went wrong on the server');
                        }
                    });
                }
            }
        ], function (err, data) {
            if (!err) {
            }
            res.json(data);
        });
    },
    getChatMessagesAPI: function (req, res, next) {
        async.waterfall([
            function (callback) {
                if (typeof req.body.user_id !== 'undefined' && (req.body.user_id).trim() && typeof req.body.to_id !== 'undefined' && (req.body.to_id).trim(), typeof req.body.type !== 'undefined' && (req.body.type).trim()) {
                    if (typeof req.body.page === 'undefined' || !(req.body.page).trim() || parseInt(req.body.page) < 1) {
                        req.body.page = 1;
                    }
                    callback(null, parseInt(req.body.to_id), parseInt(req.body.user_id), req.body.type);
                } else {
                    callback('error', {error: 1, message: 'Required fields are missing'});
                }
            },
            function (to_id, user_id, type, callback) {
                let offset = (parseInt(req.body.page) - 1) * config.get('limit');
                if (type === 'one') {
                    db.query('SELECT `gc`.*,`fu`.`name`,`fu`.`email`, `fu`.`image_url` AS `image`, `gc`.`read_status` AS `is_read`, DATE_FORMAT(`gc`.`created`,"' + config.get('DATE_FORMAT') + '") AS `created` FROM `chat` AS `gc` LEFT JOIN `users` AS `fu` ON `gc`.`from_id` = `fu`.`id` WHERE (`gc`.`from_id` = ' + user_id + ' AND `gc`.`to_id` = ' + to_id + ') OR (`gc`.`from_id` = ' + to_id + ' AND `gc`.`to_id` = ' + user_id + ') AND `gc`.`type` = "one" ORDER BY `gc`.`created` DESC LIMIT ' + offset + ',' + config.get('limit'), function (err, results) {
                        if (err) {
                            callback('Error', {error: 1, message: 'Somthing went wrong on the server. Please try again!'});
                        } else {
                            let resposneData = results.reverse();
                            _.each(resposneData, function (val) {
                                val.media_thumbnail = '';
                                val.content_url = '';
                                delete val.read_status;
                                if (val.content_type === 'video') {
                                    let fileName = val.content_name.split('.').slice(0, -1).join('.');
                                    val.media_thumbnail = '/uploads/thumb/' + fileName + '.png';
                                }
                                if (val.content_type !== 'text') {
                                    val.content_url = '/uploads/' + val.content_name;
                                }
                            });
                            callback(null, to_id, user_id, type, resposneData);
                            //callback(null, {error: 0, message: 'Users successfully listed', data: resposneData});
                        }
                    });
                } else if (type === 'two') {
                    db.query('SELECT `gc`.*,`fu`.`name`,`fu`.`email`, `fu`.`image_url` AS `image`, IF(`crgc`.`is_read` IS NULL,0,`crgc`.`is_read`) AS `is_read` , DATE_FORMAT(`gc`.`created`,"' + config.get('DATE_FORMAT') + '") AS `created` FROM `chat` AS `gc` LEFT JOIN `users` AS `fu` ON `gc`.`from_id` = `fu`.`id` LEFT JOIN (SELECT *, COUNT(`message_id`) AS `total_messages`, SUM(`status`) AS `total_read_messages`, IF(COUNT(`message_id`) = SUM(`status`),1,0) AS `is_read` FROM `chat_read_group_count` WHERE `from_id` = ' + user_id + ' GROUP BY `message_id`) AS `crgc` ON `gc`.`id` = `crgc`.`message_id` WHERE `gc`.`to_id` = ' + to_id + ' AND `gc`.`type` = "two" ORDER BY `gc`.`created` DESC LIMIT ' + offset + ',' + config.get('limit'), function (err, results) {
                        if (err) {
                            callback('Error', {error: 1, message: 'Somthing went wrong on the server. Please try again!'});
                        } else {
                            let resposneData = results.reverse();
                            _.each(resposneData, function (val) {
                                val.media_thumbnail = '';
                                val.content_url = '';
                                delete val.read_status;
                                if (val.content_type === 'video') {
                                    let fileName = val.content_name.split('.').slice(0, -1).join('.');
                                    val.media_thumbnail = '/uploads/thumb/' + fileName + '.png';
                                }
                                if (val.content_type !== 'text') {
                                    val.content_url = '/uploads/' + val.content_name;
                                }
                            });
                            callback(null, to_id, user_id, type, resposneData);
                            //callback(null, {error: 0, message: 'Users successfully listed', data: resposneData});
                        }
                    });
                } else {
                    callback('Error', {error: 1, message: 'Invalid type value'});
                }
            },
            function (to_id, user_id, type, resposneData, callback) {
//                resposneData = _.map(resposneData, function (obj) {
//                    obj.created = utilityHelper.timeZoneChange(obj.created, config.get('timezone'));
//                    return obj;
//                });
                /*********Mute Detail************/
                var response = {
                    data: resposneData,
                    config: {
                        is_mute: 0,
                        blocked_data: {
                            is_blocked: 0,
                            blocked_by_id: 0,
                            blocked_by: ''
                        }
                    }
                };
                db.query('SELECT * FROM `mute_info` WHERE `from_id` = ? AND `to_id` = ? AND `type` = ?', [user_id, to_id, type], function (err, result) {
                    if (!err) {
                        if (result.length) {
                            response.config.is_mute = parseInt(result[0].status);
                        }
                        callback(null, user_id, to_id, type, response);
                    } else {
                        callback('Error', {error: 1, message: 'Somthing went wrong on the server. Please try again!'});
                    }
                });
            },
            function (user_id, to_id, type, response, callback) {
                response.error = 0;
                response.message = 'Users successfully listed';
                if (type !== 'one') {
                    callback(null, response);
                } else {
                    db.query('SELECT `ub`.*, `au`.`name` FROM `users_blocked` AS `ub` LEFT JOIN `users` AS `au` ON `ub`.`from_id` = `au`.`id` WHERE ((`ub`.`from_id` = ? AND `ub`.`to_id` = ?) OR (`ub`.`from_id` = ? AND `ub`.`to_id` = ?)) AND `ub`.`status` = "1"', [user_id, to_id, to_id, user_id], function (err, result) {
                        if (!err) {
                            if (result.length) {
                                if (parseInt(result[0].status)) {
                                    response.config.blocked_data.is_blocked = parseInt(result[0].status);
                                    response.config.blocked_data.blocked_by_id = parseInt(result[0].from_id);
                                    response.config.blocked_data.blocked_by = result[0].name;
                                }
                            }
                            callback(null, response);
                        } else {
                            callback('Error', {error: 1, message: 'Somthing went wrong on the server. Please try again!'});
                        }
                    });
                }
            }
        ], function (err, data) {
            res.json(data);
        });
    },
    uploadMedia: function (req, res, next) {
        console.log(req.body);
        console.log(req.files);
        async.waterfall([
            function (callback) {
                if (req.body.duration === 'undefined') {
                    req.body.duration = '';
                }
                if (typeof req.files.media !== 'undefined' && typeof req.body.type !== 'undefined') {
                    var postsedFile = req.files.media;
                    callback(null, postsedFile);
                } else {
                    callback('error', {error: 1, message: 'Required fields are missing'});
                }
            },
            function (postsedFile, callback) {
                var fileNameString = randomString({
                    length: 20,
                    numeric: true,
                    letters: true,
                    special: false
                });
                var ext = postsedFile.name.split('.').pop();
                var unixTimeStamp = Math.round(+new Date() / 1000);
                var fileName = fileNameString + '_' + unixTimeStamp + '.' + ext;
                var filePath = 'public/uploads/' + fileName;
                postsedFile.mv(filePath, function (err) {
                    if (err) {
                        callback('error', {error: 1, message: 'Something went wrong on server. Please try again'});
                    } else {
                        callback(null, fileNameString + '_' + unixTimeStamp, fileName, {error: 0, message: 'Media successfully uploaded', data: {url: 'uploads/' + fileName, name: fileName, type: req.body.type, thumb: '', duration: req.body.duration}});
                    }
                });
            },
            function (fileNameString, fileName, data, callback) {
                if (req.body.type === 'video') {
                    ffmpeg(path.resolve() + '/public/uploads/' + fileName).screenshots({
                        count: 1,
                        timemarks: ['1'],
                        filename: fileNameString + '.png',
                        folder: path.resolve() + '/public/uploads/thumb',
                        size: '500x500'
                    });
                    data.data.thumb = 'uploads/thumb/' + fileNameString + '.png';
                    callback(null, data);
                } else {
                    callback(null, data);
                }
            }
        ], function (err, data) {
            res.json(data);
        });
    },
    uploadWebMedia: function (req, res, next) {
        async.waterfall([
            function (callback) {
                var postsedFile = req.files.media;
                if (typeof postsedFile !== 'undefined' && typeof req.body.type !== 'undefined') {
                    callback(null, postsedFile);
                } else {
                    callback('error', {error: 1, message: 'Required fields are missing'});
                }
            },
            function (postsedFile, callback) {
                var fileNameString = randomString({
                    length: 20,
                    numeric: true,
                    letters: true,
                    special: false
                });
                var ext = postsedFile.name.split('.').pop();
                var unixTimeStamp = Math.round(+new Date() / 1000);
                var fileName = fileNameString + '_' + unixTimeStamp + '.' + ext;
                var filePath = 'public/uploads/' + fileName;
                postsedFile.mv(filePath, function (err) {
                    if (err) {
                        callback('error', {error: 1, message: 'Something went wrong on server. Please try again'});
                    } else {
                        callback(null, fileNameString + '_' + unixTimeStamp, fileName, {error: 0, message: 'Media successfully uploaded', data: {url: 'uploads/' + fileName, type: req.body.type, name: fileName, thumb: '', duration: ''}});
                    }
                });
            },
            function (fileNameString, fileName, data, callback) {
                data.data.thumb = '';
                if (req.body.type === 'video') {
                    ffmpeg(path.resolve() + '/public/uploads/' + fileName).screenshots({
                        count: 1,
                        timemarks: ['1'],
                        filename: fileNameString + '.png',
                        folder: path.resolve() + '/public/uploads/thumb',
                        size: '500x500'
                    });
                    data.data.thumb = '/uploads/thumb/' + fileNameString + '.png';
                    ffmpeg.ffprobe(path.resolve() + '/public/uploads/' + fileName, function (err, metadata) {
                        data.data.duration = metadata.format.duration * 1000;
                        callback(null, data);
                    });
                } else if (req.body.type === 'audio') {
                    ffmpeg.ffprobe(path.resolve() + '/public/uploads/' + fileName, function (err, metadata) {
                        data.data.duration = metadata.format.duration * 1000;
                        callback(null, data);
                    });
                } else {
                    callback(null, data);
                }
            }
        ], function (err, data) {
            res.json(data);
        });
    },
    loadNext: function (req, res, next) {
        async.waterfall([
            function (callback) {
                let to_id = req.body.to_id;
                let type = req.body.type;
                let userData = req.session.userData;
                let messageId = req.body.id;
                if (typeof userData !== 'undefined') {
                    callback(null, to_id, userData.id, type, messageId);
                } else {
                    callback('Error', 'You are not allowed to access this URL');
                }
            },
            function (to_id, user_id, type, messageId, callback) {
                if (type === 'one') {
                    db.query('SELECT `gc`.*,`fu`.`name`, `fu`.`image_url` AS `user_image`, `gc`.`read_status` AS `is_read` ,DATE_FORMAT(`gc`.`created`,"' + config.get('DATE_FORMAT') + '") AS `created` FROM `chat` AS `gc` LEFT JOIN `users` AS `fu` ON `gc`.`from_id` = `fu`.`id` WHERE ((`gc`.`from_id` = ' + user_id + ' AND `gc`.`to_id` = ' + to_id + ') OR (`gc`.`from_id` = ' + to_id + ' AND `gc`.`to_id` = ' + user_id + ') AND `gc`.`type` = "one") AND `gc`.`id` < ' + messageId + ' ORDER BY `gc`.`created` DESC LIMIT ' + config.get('limit'), function (err, results) {
                        if (err) {
                            callback('Error', 'Somthing went wrong on the server. Please try again!');
                        } else {
                            req.session.userData.to_id = to_id;
                            var resposneData = results;
                            req.session.userData.to_id = to_id;
                            _.each(resposneData, function (val) {
                                val.media_thumbnail = '';
                                val.content_url = '';
                                delete val.read_status;
                                if (val.content_type === 'video') {
                                    let fileName = val.content_name.split('.').slice(0, -1).join('.');
                                    val.media_thumbnail = '/uploads/thumb/' + fileName + '.png';
                                }
                                if (val.content_type !== 'text') {
                                    val.content_url = '/uploads/' + val.content_name;
                                }
                            });
                            resposneData = _.map(resposneData, function (obj) {
                                obj.created = utilityHelper.timeZoneChange(obj.created, config.get('timezone'));
                                return obj;
                            });
                            callback(null, resposneData);
                        }
                    });
                } else if (type === 'two') {
                    db.query('SELECT `gc`.*,`fu`.`name`, `fu`.`image_url` AS `user_image`, IF(`crgc`.`is_read` IS NULL,0,`crgc`.`is_read`) AS `is_read` , DATE_FORMAT(`gc`.`created`,"' + config.get('DATE_FORMAT') + '") AS `created` FROM `chat` AS `gc` LEFT JOIN `users` AS `fu` ON `gc`.`from_id` = `fu`.`id` LEFT JOIN (SELECT *, COUNT(`message_id`) AS `total_messages`, SUM(`status`) AS `total_read_messages`, IF(COUNT(`message_id`) = SUM(`status`),1,0) AS `is_read` FROM `chat_read_group_count` WHERE `from_id` = ' + req.session.userData.id + ' GROUP BY `message_id`) AS `crgc` ON `gc`.`id` = `crgc`.`message_id` WHERE (`gc`.`to_id` = ' + to_id + ' AND `gc`.`type` = "two") AND `gc`.`id` < ' + messageId + ' ORDER BY `gc`.`created` DESC LIMIT ' + config.get('limit'), function (err, results) {
                        if (err) {
                            callback('Error', 'Somthing went wrong on the server. Please try again!');
                        } else {
                            let resposneData = results;
                            _.each(resposneData, function (val) {
                                val.media_thumbnail = '';
                                val.content_url = '';
                                delete val.read_status;
                                if (val.content_type === 'video') {
                                    let fileName = val.content_name.split('.').slice(0, -1).join('.');
                                    val.media_thumbnail = '/uploads/thumb/' + fileName + '.png';
                                }
                                if (val.content_type !== 'text') {
                                    val.content_url = '/uploads/' + val.content_name;
                                }
                            });
                            resposneData = _.map(resposneData, function (obj) {
                                obj.created = utilityHelper.timeZoneChange(obj.created, config.get('timezone'));
                                return obj;
                            });
                            callback(null, resposneData);
                        }
                    });
                } else {
                    callback('Error', 'Invalid type value');
                }
            }
        ], function (err, data) {
            if (!err) {
            }
            res.json(data);
        });
    }
};

module.exports = ChatController;