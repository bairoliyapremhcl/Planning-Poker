
Ext.define('Niks.Apps.TeamPicker', {
    constructor: function() {
        this.callParent();
    }
});

Ext.define('Niks.Apps.PlanningGame', {
    extend: 'Rally.app.App',
    componentCls: 'app',

    //Only save the least amount of data in here. We only have 32768 chars to play with
    _gameConfig: {},

    config: {
        configFieldName: "c_PlanningPokerConfig",
        planningPokerTitle: '^'
    },

    statics: {
        SAVE_FAIL_RETRIES: 5
    },

    _kickOff: function() {
        var me = this;

        /** We need to load up the project specific config now.
         * Firstly, we need the team members
         */
        var record = this.projectStore.getRecords()[0];
        if ( record.get('TeamMembers').Count > 0) {
            record.getCollection('TeamMembers').load( {
                fetch: true,
                callback: function( members, operation, success) {
                    //Add all the team members to the GameConfig
                    if (success === true) {
                        _.each(members, function(member) {
                            me._gameConfig.addUser(member);
                        });
                    }
                    else {
                        console.log("Team members field unavailable");
                    }
                },
                scope: me
            });
        }
        else {
            Rally.ui.notify.Notifier.showWarning({ message: "Team members not configured"});
        }

    },

    launch: function () {
        var me = this;
        me._gameConfig = Ext.create('Niks.Apps.PokerGameConfig');
        //Check for required fields in this project node

        //Create config page and then pull config from project node if exists. If not, create.
        //If not config already, ask the user if they are to be the Moderator for this.

        /** Set up a timer that reads the config every 1sec so that we pull changes from other users
         * 
         */

        this._checkProjectFieldConfig().then( {
            success: function(result) {
                this._getProjectConfig(result).then({
                    success: function(projConfig) {
                        if (projConfig.length === 0) {
                            //Set up new config
                            Ext.create('Rally.ui.dialog.ConfirmDialog', {
                                title: "New Config",
                                message: "Are you moderator for this session?",
                                listeners: {
                                    confirm: function() {
                                        //Set user up as moderator
                                        me._gameConfig.mergeConfig( { moderator: me.getContext().getUser().ObjectID});
                                        me._saveProjectConfig().then({
                                            success: function() {
                                                /** Config saved and we are ready to go */
                                                me._kickOff();
                                            },
                                            failure: function(e) {
                                                console.log("Failed to save project config",e);
                                            },
                                            scope: me
                                        });
                                    }
                                }
                            });
                        }
                        else {
                            // Ready to go
                            me._gameConfig.mergeConfig(JSON.parse(projConfig));
                            me._kickOff();
                        }
                    },
                    failure: function(e) {
                        console.log(e);
                    },
                    scope: me
                });
            },
            failure: function(e) {
                console.log(e);
            },
            scope: me
        });

    },

    _createStoryBrowser: function() {
        var deferred = Ext.create("Deft.Deferred");
        return deferred.promise;

    },

    _createUserMenu: function() {
        /** Each user must have a way to save and restore their current settings/layout */
        var deferred = Ext.create("Deft.Deferred");
        return deferred.promise;

    },

    _createLeadMenu: function() {
        /** Lead menu must have access to the config page */
        var deferred = Ext.create("Deft.Deferred");
        return deferred.promise;

    },

    /** Make sure that the system is set up the way we need */
    _checkProjectFieldConfig: function() {
        var me = this;
        //Check field PlanningConfig exists on project model
        var deferred = Ext.create("Deft.Deferred");

        Rally.data.ModelFactory.getModel({
            type: "Project",
            fetch: true,
            success: function(model) {
                //Add any prechecks here
                if (model.hasField(me.configFieldName)) {
                    deferred.resolve(model);
                } else {
                    //Here, we need to ask if they want to set up the new field (need to be workspace admin)
                    deferred.reject("Correct Config not available");
                }
            },
            failure: function() {
                //Shouldn't happen unless Rally is down
                deferred.reject("Failed to get Project Model");
            }
        });
        return deferred.promise;
    },

    /** As the game progresses, we need to save the state of the game. 
     * We will need to do retries due to concurrency errors that we might get with a number
     * of people trying to update the same field on the Project.
     * 
     * We also will need to be able to reload the last config to get back to where we were 
     * in the game before, if there is ever any issues (browser crash, network error, etc., etc.)
     *  For this, we should put a "refresh" button on the top menu bar
    */
    
    _getProjectConfig: function(model) {   /** parameter provided is Project Model, but not the actual data */
        var me = this;
        var deferred = Ext.create("Deft.Deferred");
        /** 
         * The current context should contain the Project record that we are currently at. 
         * We could change this to be a project picker if that becomes a useful feature.
         * Even if we update the Project field, then the environment keeps that handily local.
        */

        var project = this.getContext().getProject();
        me.projectStore = Ext.create( 'Rally.data.wsapi.Store', {
            model: model.typeDefName,
            filters: [{
                property: 'ObjectID',
                value: project.ObjectID
            }],
            autoLoad: true,
            fetch: true,
            listeners: {
                load: function(store, records) {
                    var currentConfig = this._decodeMsg("MainConfig", records[0].get(this.configFieldName));
                    deferred.resolve(currentConfig);
                },
                scope: me
            }
        });

        return deferred.promise;
    },

    _failedSave: 0,

    /** Save the current config */
    _saveProjectConfig: function(existingDefer) {
        var me = this;
        var deferred = (existingDefer === undefined) ? Ext.create("Deft.Deferred") : existingDefer;
        var currentConfig = JSON.stringify(this._gameConfig);
        var record = this.projectStore.getRecords()[0];
        record.set(this.configFieldName, this._encodeMsg("MainConfig", currentConfig));
        record.save({
            success: function() {
                this._failedSave = 0;
                Rally.ui.notify.Notifier.show({ message: "Config Saved to Project"});
                deferred.resolve();
            },
            failure: function() {
                if (this._failedSave < this.self.SAVE_FAIL_RETRIES) {
                    this._saveProjectConfig(deferred);
                }
                else {
                    deferred.reject("Failed to save Project Config");
                }
            },
            scope: me
        });
        return deferred.promise;
    },

    _checkConfigChange: function(newConfig) {
        console.log(newConfig);
    },

    //Create and hide the config page
    _createConfigPage: function() {
        /** Config page must have:
         * 1. Moderator Chooser
         * 2. Team member list - enables for this session
         * 3. Timer countdown duration
         * 4. Iteration for this session
         */
        var deferred = Ext.create("Deft.Deferred");
        return deferred.promise;
    },

    /** Make the main pages that the game players need
     * 
     */
    _createUserPage: function() {
        var deferred = Ext.create("Deft.Deferred");
        return deferred.promise;
    },

    _createLeadPage: function() {
        var deferred = Ext.create("Deft.Deferred");
        return deferred.promise;
    },

    /** Utility functions
     * 
     * At some point we will need to add the ability to store multiple entries in the game config, search for the right one
     * to create/read/update/delete
     */

    _encodeMsg: function(msgType, msgText) {
        return this.planningPokerTitle + msgType + "," + window.btoa(msgText);
    },

    _decodeMsg: function(msgType, msgText) {
        return window.atob(msgText.split(",").pop());
    }
});
