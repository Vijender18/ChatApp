var db = require('../database/database');
var _ = require('underscore');
var dateFormat = require('dateformat');
var chatHelper = require('../helpers/ChatHelper');
var moment = require('moment');
var GroupModel = {
    getGroupInfo: function (group_id, group_name, group_users, user_id, callback) {
        db.query("SELECT `ag`.*, CONCAT('[',GROUP_CONCAT('{\"id\":\"',`agu`.`id`,'\",\"user_id\":\"',`agu`.`user_id`,'\", \"status\":\"',`agu`.`status`,'\", \"is_deleted\": \"',`agu`.`is_deleted`,'\", \"existed\": \"',`agu`.`existed`,'\"}'),']') AS `users_info` FROM `groups` AS `ag` LEFT JOIN `group_users` AS `agu` ON `ag`.`id` = `agu`.`group_id` WHERE `ag`.`id` = ? AND `ag`.`user_id` = ? GROUP BY `ag`.`id`", [group_id, user_id], function (err, result) {
            if (err) {
                callback('Error', {error: 1, message: 'Something went wrong on the server. Please try again!'});
            } else {
                if (result.length) {
                    callback(null, group_id, group_name, group_users, user_id, result[0]);
                } else {
                    callback('Error', {error: 1, message: 'Invalid data or You have no permission to edit the group'});
                }
            }
        });
    },
    updateGroupData: function (group_id, group_name, new_users_to_add, users_to_delete,reInviteUsers, callback) {
        db.query('UPDATE `groups` SET name = ? WHERE `id` = ?', [group_name, group_id], function (err, result) {
            if (err) {
                callback('Error', {error: 1, message: 'Something went wrong on the server. Please try again!'});
            } else {
                chatHelper.editGroupNotify(group_id);
                callback(null, group_id, new_users_to_add, users_to_delete,reInviteUsers);
            }
        });
    },
    addNewGroupUsers: function (group_id, new_users_to_add, users_to_delete,reInviteUsers, callback) {
        var now = new Date();
        if (!new_users_to_add.length) {
            callback(null, group_id, users_to_delete,reInviteUsers);
        } else {
            var queryData = [];
            var groupUsersArr = new_users_to_add;
            _.each(groupUsersArr, function (group_user_id) {
                queryData.push('(' + group_user_id + ',' + group_id + ', 0)');
            });
            db.query('INSERT INTO group_users (user_id, group_id, status) VALUES ' + queryData.join(', '), function (err, result) {
                if (err) {
                    callback('error', {error: 1, message: 'Something went wrong on server. Please try again'});
                } else {
                    var queryData = [];
                    var groupUsersArr = new_users_to_add;
                    _.each(groupUsersArr, function (group_user_id) {
                        queryData.push('(' + group_user_id + ',' + group_id + ', "","two","text","' + moment.utc().format('YYYY-MM-DD HH:mm:ss') + '")');
                    });
                    db.query('INSERT INTO chat (`from_id`, `to_id`,`message`,`type`,`content_type`,`created`) VALUES ' + queryData.join(','), function (err, result) {
                        if (err) {
                            callback('error', {error: 1, message: 'Something went wrong on server. Please try again'});
                        } else {
                            chatHelper.newGroupUsersNotify(group_id,new_users_to_add);
                            callback(null, group_id, users_to_delete,reInviteUsers);
                        }
                    });
                }
            });
        }
    },
    deleteGroupUsers: function(group_id, users_to_delete,reInviteUsers,callback){
        if(!users_to_delete.length) {
            callback(null,group_id,reInviteUsers);
        } else {
            db.query('DELETE FROM group_users WHERE group_id = ? AND user_id IN (?)',[group_id,users_to_delete.join(', ')],function(err, result){
                if(err) {
                    callback('error', {error: 1, message: 'Something went wrong on server. Please try again'});
                } else {
                    chatHelper.notifyGroupUserDelete(group_id,users_to_delete);
                    callback(null,group_id,reInviteUsers);
                }
            });
        }
    },
    reInviteGroupUsers: function(group_id,reInviteUsers,callback) {
        if(!reInviteUsers.length) {
            callback(null,{ error: 0, message: 'Group Successfully updated' });
        } else {
            var queryDataWhere = [];
            _.each(reInviteUsers,function(val){
                queryDataWhere.push(' `user_id` = "'+val+'"');
            });
            db.query('UPDATE `group_users` SET `status` = 0 WHERE ' + queryDataWhere.join(' OR '),function(err,result){
                if(err) {
                    callback('error', {error: 1, message: 'Something went wrong on server. Please try again'});
                } else {
                    chatHelper.newGroupUsersNotify(group_id,reInviteUsers);
                    callback(null,{ error: 0, message: 'Group Successfully updated' });
                }
            });
        }
    }
};
module.exports = GroupModel;