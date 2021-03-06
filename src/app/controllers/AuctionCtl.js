angular.module('auction').controller('AuctionController',[
  '$scope', 'AuctionConfig', 'AuctionUtils',
  '$timeout', '$http', '$log', '$cookies', '$cookieStore', '$window',
  '$rootScope', '$location', '$translate', '$filter', 'growl', 'growlMessages', '$aside', '$q',
  function($scope, AuctionConfig, AuctionUtils,
  $timeout, $http, $log, $cookies, $cookieStore, $window,
  $rootScope, $location, $translate, $filter, growl, growlMessages, $aside, $q)
  {
    var sse_url = window.location.href.replace(window.location.search, '');
    var evtSrc = '';
    var response_timeout = '';

    if (AuctionUtils.inIframe() && 'localhost'!= location.hostname) {
      $log.error('Starts in iframe');
      window.open(location.href, '_blank');
      return false;
    }

    AuctionConfig.auction_doc_id = window.location.pathname.replace('/esco-tenders/', '');

    $scope.lang = 'uk';
    $rootScope.normilized = false;
    $rootScope.format_date = AuctionUtils.format_date;
    $scope.bidder_id = null;
    $scope.bid = null;
    $scope.current_npv = 0;
    $scope.follow_login_allowed = false;
    $scope.allow_bidding = true;
    $rootScope.form = {};
    $rootScope.alerts = [];
    $scope.default_http_error_timeout = 500;
    $scope.http_error_timeout = $scope.default_http_error_timeout;
    $scope.browser_client_id = AuctionUtils.generateUUID();
    $scope.$watch(function() {return $cookies.logglytrackingsession; }, function(newValue, oldValue) {
      $scope.browser_session_id = $cookies.logglytrackingsession;
    });
    $log.info({
      message: "Start session",
      browser_client_id: $scope.browser_client_id,
      user_agent: navigator.userAgent,
      tenderId: AuctionConfig.auction_doc_id
    });
    $rootScope.change_view = function() {
      if ($scope.bidder_coeficient) {
        $rootScope.normilized = !$rootScope.normilized;
      }
    };
    $scope.start = function() {
      $log.info({
        message: "Setup connection to remote_db",
        auctions_loggedin: $cookies.auctions_loggedin||AuctionUtils.detectIE()
      });
      if ($cookies.auctions_loggedin||AuctionUtils.detectIE()) {
        AuctionConfig.remote_db = AuctionConfig.remote_db + "_secured";
      }
      $scope.changes_options = {
        timeout: 40000 - Math.ceil(Math.random() * 10000),
        heartbeat: 10000,
        live: true,
        style: 'main_only',
        continuous: true,
        include_docs: true,
        doc_ids: [AuctionConfig.auction_doc_id],
        since: 0
      };
      new PouchDB(AuctionConfig.remote_db).then(function(db) {
        $scope.db = db;
        $scope.http_error_timeout = $scope.default_http_error_timeout;
        $scope.start_auction_process();
      }).catch(function(error) {
        $log.error({
          message: "Error on setup connection to remote_db",
          error_data: error
        });
        $scope.http_error_timeout = $scope.http_error_timeout * 2;
        $timeout(function() {
          $scope.start();
        }, $scope.http_error_timeout);
      });
    };
    $scope.growlMessages = growlMessages;

    // ESCO Constants
    $scope.DAYS_IN_YEAR = 365;
    $scope.NPV_CALCULATION_DURATION = 20;
    growlMessages.initDirective(0, 10);
    dataLayer.push({
      "tenderId": AuctionConfig.auction_doc_id
    });
    if (($translate.storage().get($translate.storageKey()) === "undefined") || ($translate.storage().get($translate.storageKey()) === undefined)) {
      $translate.use(AuctionConfig.default_lang);
      $scope.lang = AuctionConfig.default_lang;
    } else {
      $scope.lang = $translate.storage().get($translate.storageKey()) || $scope.lang;
    }

    /*      Time stopped events    */
    $rootScope.$on('timer-stopped', function(event) {
      if (($scope.auction_doc) && (event.targetScope.timerid == 1) && ($scope.auction_doc.current_stage == -1)) {
        if (!$scope.auction_not_started){
          $scope.auction_not_started = $timeout(function() {
            if($scope.auction_doc.current_stage === -1){
              growl.warning('Please wait for the auction start.', {ttl: 120000, disableCountDown: true});
              $log.info({message: "Please wait for the auction start."});
            }
          }, 10000);
        }

        $timeout(function() {
          if($scope.auction_doc.current_stage === -1){
            $scope.sync_times_with_server();
          }
        }, 120000);
      }
    });
    /*      Time tick events    */
    $rootScope.$on('timer-tick', function(event) {
      if (($scope.auction_doc) && (event.targetScope.timerid == 1)) {
        if (((($rootScope.info_timer || {}).msg || "") === 'until your turn') && (event.targetScope.minutes == 1) && (event.targetScope.seconds == 50)) {
          $http.post(sse_url + '/check_authorization').success(function(data) {
            $log.info({
              message: "Authorization checked"
            });
          }).error(function(data, status, headers, config) {
            $log.error({
              message: "Error while check_authorization"
            });
            if (status == 401) {
              growl.error('Ability to submit bids has been lost. Wait until page reloads.');
              $log.error({
                message: "Ability to submit bids has been lost. Wait until page reloads."
              });
              $timeout(function() {
                window.location.replace(window.location.href + '/relogin');
              }, 3000);
            }
          });
        };
        $timeout(function() {
          $rootScope.time_in_title = event.targetScope.days ? (event.targetScope.days + $filter('translate')('days') + " ") : "";
          $rootScope.time_in_title += event.targetScope.hours ? (AuctionUtils.pad(event.targetScope.hours) + ":") : "";
          $rootScope.time_in_title += (AuctionUtils.pad(event.targetScope.minutes) + ":");
          $rootScope.time_in_title += (AuctionUtils.pad(event.targetScope.seconds) + " ");
        }, 10);
      } else {
        var date = new Date();
        $scope.seconds_line = AuctionUtils.polarToCartesian(24, 24, 16, (date.getSeconds() / 60) * 360);
        $scope.minutes_line = AuctionUtils.polarToCartesian(24, 24, 16, (date.getMinutes() / 60) * 360);
        $scope.hours_line = AuctionUtils.polarToCartesian(24, 24, 14, (date.getHours() / 12) * 360);
      }
    });

    /*      Kick client event    */
    $scope.$on('kick_client', function(event, client_id, msg) {
      $log.info({
        message: 'disable connection for client' + client_id
      });
      $scope.growlMessages.deleteMessage(msg);

      $http.post(sse_url + '/kickclient', {
        'client_id': client_id,
      }).success(function(data) {
        $log.info({message: 'disable connection for client ' + client_id});
      });
    });
    //

    $scope.start_subscribe = function(argument) {
      $log.info({message: 'Start event source'});

      var response_timeout = $timeout(function() {
      $http.post(sse_url + '/set_sse_timeout', {timeout: '7'}).then((data)=>{
        $log.info({message: 'Handled set_sse_timeout on event source'});
      }, (error)=>{
        $log.error("Error on setting sse_timeout " + error);
      });
      $log.info({message: 'Start set_sse_timeout on event source', timeout: response_timeout});
      }, 20000);

      evtSrc = new EventSource(sse_url + '/event_source', {withCredentials: true});
      $scope.restart_retries_events = 3;
      evtSrc.addEventListener('ClientsList', function(e) {
        var data = angular.fromJson(e.data);
        $log.info({message: 'Get Clients List', clients: data});

        $scope.$apply(function() {
          var i;
          if (angular.isObject($scope.clients)) {
            for (i in data) {
              if (!(i in $scope.clients)) {
                growl.warning($filter('translate')('In the room came a new user') + ' (IP:' + data[i].ip + ')' + '<button type="button" ng-click="$emit(\'kick_client\', + \'' + i + '\', message )" class="btn btn-link">' + $filter('translate')('prohibit connection') + '</button>', {
                  ttl: 30000,
                  disableCountDown: true
                });
              }
            }
          }
          $scope.clients = data;
        });
      }, false);
      evtSrc.addEventListener('Tick', function(e) {
        $scope.restart_retries_events = 3;
        var data = angular.fromJson(e.data);
        $scope.last_sync = new Date(data.time);
        $log.debug({
          message: "Tick: " + data
        });
        if ($scope.auction_doc.current_stage > -1) {
          $rootScope.info_timer = AuctionUtils.prepare_info_timer_data($scope.last_sync, $scope.auction_doc, $scope.bidder_id, $scope.Rounds);
          $log.debug({
            message: "Info timer data",
            info_timer: $rootScope.info_timer
          });
          $rootScope.progres_timer = AuctionUtils.prepare_progress_timer_data($scope.last_sync, $scope.auction_doc);
          $log.debug({
            message: "Progres timer data",
            progress_timer: $rootScope.progres_timer
          });
        }

      }, false);
      evtSrc.addEventListener('Identification', function(e) {
        if (response_timeout) {
          $timeout.cancel(response_timeout);
        }
        var data = angular.fromJson(e.data);
        $log.info({message: "Get Identification", bidder_id: data.bidder_id, client_id: data.client_id});

        $scope.start_sync_event.resolve('start');
        $scope.$apply(function() {
          $scope.bidder_id = data.bidder_id;
          $scope.client_id = data.client_id;
          $scope.return_url = data.return_url;
          if ('coeficient' in data) {
            $scope.bidder_coeficient = math.fraction(data.coeficient);
            $log.info({message: "Get coeficient " + $scope.bidder_coeficient});
          }
        });
      }, false);

      evtSrc.addEventListener('RestoreBidAmount', function(e) {
        if (response_timeout) {
          $timeout.cancel(response_timeout);
        }
        var data = angular.fromJson(e.data);
        $log.debug({
          message: "RestoreBidAmount"
        });
        $scope.$apply(function() {
          $rootScope.form.bid = data.last_amount;
        });
      }, false);

      evtSrc.addEventListener('KickClient', function(e) {
        var data = angular.fromJson(e.data);
        $log.info({
          message: "Kicked"
        });
        window.location.replace(window.location.protocol + '//' + window.location.host + window.location.pathname + '/logout');
      }, false);
      evtSrc.addEventListener('Close', function(e) {
        $timeout.cancel(response_timeout);
        $log.info({
          message: "Handle close event source",
          error: e,
        });
        if (!$scope.follow_login_allowed) {
          growl.info($filter('translate')('You are an observer and cannot bid.'), {
            ttl: -1,
            disableCountDown: true
          }, 500);
          var params = AuctionUtils.parseQueryString(location.search);
          if (params.loggedin) {
            $timeout(function() {
              window.location.replace(window.location.protocol + '//' + window.location.host + window.location.pathname);
            }, 1000);
          }
        }
        $scope.start_sync_event.resolve('start');
        evtSrc.close();
      }, false);
      evtSrc.onerror = function(e) {
        $timeout.cancel(response_timeout);
        $log.error({
          message: "Handle event source error",
          error_data: e
        });
        $scope.restart_retries_events = $scope.restart_retries_events - 1;
        if ($scope.restart_retries_events === 0) {
          evtSrc.close();
          $log.info({
            message: "Handle event source stoped"
          });
          if (!$scope.follow_login_allowed) {
            growl.info($filter('translate')('You are an observer and cannot bid.'), {
              ttl: -1,
              disableCountDown: true
            });
          }
        }
        return true;
      };
    };
    $scope.changeLanguage = function(langKey) {
      $translate.use(langKey);
      $scope.lang = langKey;
    };
    // Bidding form msgs
    $scope.closeAlert = function(msg_id) {
      for (var i = 0; i < $rootScope.alerts.length; i++) {
        if ($rootScope.alerts[i].msg_id == msg_id) {
          $rootScope.alerts.splice(i, 1);
          return true;
        }
      }
    };
    $scope.auto_close_alert = function(msg_id) {
      $timeout(function() {
        $scope.closeAlert(msg_id);
      }, 4000);
    };
    $scope.get_round_number = function(pause_index) {
      return AuctionUtils.get_round_data(pause_index, $scope.auction_doc, $scope.Rounds);
    };
    $scope.show_bids_form = function(argument) {
      if ((angular.isNumber($scope.auction_doc.current_stage)) && ($scope.auction_doc.current_stage >= 0)) {
        if (($scope.auction_doc.stages[$scope.auction_doc.current_stage].type == 'bids') && ($scope.auction_doc.stages[$scope.auction_doc.current_stage].bidder_id == $scope.bidder_id)) {
          $log.info({
            message: "Allow view bid form"
          });
          $scope.max_bid_amount();
          $scope.view_bids_form = true;
          return $scope.view_bids_form;
        }
      }
      $scope.view_bids_form = false;
      return $scope.view_bids_form;
    };
    $scope.sync_times_with_server = function(start) {
      $http.get('/get_current_server_time', {
        'params': {
          '_nonce': Math.random().toString()
        }
      }).success(function(data, status, headers, config) {
        $scope.last_sync = new Date(new Date(headers().date));
        $rootScope.info_timer = AuctionUtils.prepare_info_timer_data($scope.last_sync, $scope.auction_doc, $scope.bidder_id, $scope.Rounds);
        $log.debug({
          message: "Info timer data:",
          info_timer: $rootScope.info_timer
        });
        $rootScope.progres_timer = AuctionUtils.prepare_progress_timer_data($scope.last_sync, $scope.auction_doc);
        $log.debug({
          message: "Progres timer data:",
          progress_timer: $rootScope.progres_timer
        });
        var params = AuctionUtils.parseQueryString(location.search);
        if ($scope.auction_doc.current_stage == -1) {
          if ($rootScope.progres_timer.countdown_seconds < 900) {
            $scope.start_changes_feed = true;
          } else {
            $timeout(function() {
              $scope.follow_login = true;
              $scope.start_changes_feed = true;
            }, ($rootScope.progres_timer.countdown_seconds - 900) * 1000);
          }
        }
        if ($scope.auction_doc.current_stage >= -1 && params.wait) {
          $scope.follow_login_allowed = true;
          if ($rootScope.progres_timer.countdown_seconds < 900) {
            $scope.follow_login = true;
          } else {
            $scope.follow_login = false;
            $timeout(function() {
              $scope.follow_login = true;
            }, ($rootScope.progres_timer.countdown_seconds - 900) * 1000);
          }
          $scope.login_params = params;
          delete $scope.login_params.wait;
          $scope.login_url =  sse_url + '/login?' + AuctionUtils.stringifyQueryString($scope.login_params);
        } else {
          $scope.follow_login_allowed = false;
        }
      }).error(function(data, status, headers, config) {

      });
    };
    $scope.warning_post_bid = function(){
      growl.error('Unable to place a bid. Check that no more than 2 auctions are simultaneously opened in your browser.');
    };
    $scope.calculate_yearly_payments = function(annual_costs_reduction, yearlyPaymentsPercentage){
      return math.fraction(annual_costs_reduction) * math.fraction(yearlyPaymentsPercentage)
    }
    $scope.calculate_npv = function(nbu_rate,
                                    annual_costs_reduction,
                                    yearlyPayments,
                                    contractDurationYears,
                                    yearlyPaymentsPercentage=0.0,
                                    contractDurationDays=0.0
                                    ){
      if (yearlyPaymentsPercentage) {
        yearlyPayments = $scope.calculate_yearly_payments(annual_costs_reduction, yearlyPaymentsPercentage)
      }
      if (contractDurationDays) {
        var CF_incomplete = (n) => {
          if (n === contractDurationYears + 1){
            return math.fraction(math.fraction(contractDurationDays, $scope.DAYS_IN_YEAR) * yearlyPayments)
          }
          else{
            return 0
          }
        }
      }
      else
      {
        var CF_incomplete = (n) =>{
          return 0
        }
      }
      var CF = (n) =>{
        if (n <= contractDurationYears){
          return yearlyPayments
        }
        else{
          return CF_incomplete(n)
        }
      }
      var npv = 0;
      for (i=1;i<=$scope.NPV_CALCULATION_DURATION;i++)
      {
        npv = npv + math.fraction(annual_costs_reduction - CF(i)) / (math.fraction(1 + nbu_rate) ** i);
      }
      return npv;
    }
    $scope.calculate_current_npv = function(){
       contractDurationYears = $rootScope.form.contractDurationYears || 0;
       contractDurationDays = $rootScope.form.contractDurationDays || 0;
       yearlyPayments = $rootScope.form.yearlyPayments || 0;
       yearlyPaymentsPercentage = $rootScope.form.yearlyPaymentsPercentage || 0;
        $scope.current_npv = $scope.calculate_npv(
             $scope.auction_doc.NBUdiscountRate,
             $scope.get_annual_costs_reduction($scope.bidder_id),
             parseFloat(yearlyPayments.toFixed(2)),
             parseInt(contractDurationYears.toFixed()),
             parseFloat((yearlyPaymentsPercentage / 100).toFixed(5)),
             parseInt(contractDurationDays.toFixed())
        )
    }
    $scope.post_bid = function(contractDurationYears, contractDurationDays, yearlyPayments, yearlyPaymentsPercentage) {
      contractDurationYears = contractDurationYears || $rootScope.form.contractDurationYears || 0;
      contractDurationDays = contractDurationDays || $rootScope.form.contractDurationDays || 0;
      yearlyPayments = yearlyPayments || $rootScope.form.yearlyPayments || 0;
      yearlyPaymentsPercentage = yearlyPaymentsPercentage || $rootScope.form.yearlyPaymentsPercentage || 0;
      $log.info({
        'message': "Start post bid",
        'contractDuration': parseInt(contractDurationYears.toFixed()),
        'contractDurationDays':  parseInt(contractDurationDays.toFixed()),
        'yearlyPayments':  parseFloat(yearlyPayments.toFixed(2)),
        'yearlyPaymentsPercentage': parseFloat((yearlyPaymentsPercentage / 100).toFixed(5))
      });

      // XXX TODO Validation for to low value
      if ($rootScope.form.contractDurationYears.toFixed() == -1 || $rootScope.form.yearlyPayments.toFixed() == -1) {
            var msg_id = Math.random();
            $rootScope.alerts.push({
              msg_id: msg_id,
              type: 'danger',
              msg: 'To low value'
            });
            $scope.auto_close_alert(msg_id);
            return 0;
      }
      if ($rootScope.form.BidsForm.$valid) {
        $rootScope.alerts = [];

        var bid_amount = $scope.calculate_npv($scope.auction_doc.NBUdiscountRate,
                                       $scope.get_annual_costs_reduction($scope.bidder_id),
                                       parseFloat(yearlyPayments.toFixed(2)),
                                       parseInt(contractDurationYears.toFixed()),
                                       parseFloat(yearlyPaymentsPercentage.toFixed(3)),
                                       parseInt(contractDurationDays.toFixed())
                                     )
        if (bid_amount == $scope.minimal_bid.amount) {
          var msg_id = Math.random();
          $rootScope.alerts.push({
            msg_id: msg_id,
            type: 'warning',
            msg: 'The proposal you have submitted coincides with a proposal of the other participant. His proposal will be considered first, since it has been submitted earlier.'
          });
        }
        $rootScope.form.active = true;
        $timeout(function() {
          $rootScope.form.active = false;
        }, 5000);
        if (!$scope.post_bid_timeout) {
          $scope.post_bid_timeout = $timeout($scope.warning_post_bid, 10000);
        }

        $http.post(sse_url + '/postbid', {
          'contractDuration': parseInt(contractDurationYears.toFixed()),
          'contractDurationDays': parseInt(contractDurationDays.toFixed()),
          'yearlyPayments':  parseFloat(yearlyPayments.toFixed(2)),
          'yearlyPaymentsPercentage':  parseFloat((yearlyPaymentsPercentage / 100).toFixed(5)),
          'bidder_id': $scope.bidder_id || bidder_id || "0"
        }).success(function(data) {
          if ($scope.post_bid_timeout){
            $timeout.cancel($scope.post_bid_timeout);
            delete $scope.post_bid_timeout;
          }
          $rootScope.form.active = false;
          var msg_id = '';
          if (data.status == 'failed') {
            for (var error_id in data.errors) {
              for (var i in data.errors[error_id]) {
                msg_id = Math.random();
                $rootScope.alerts.push({
                  msg_id: msg_id,
                  type: 'danger',
                  msg: data.errors[error_id][i]
                });
                $log.info({
                  message: "Handle failed response on post bid",
                  bid_data: data.errors[error_id][i]
                });
                $scope.auto_close_alert(msg_id);
              }
            }
          } else {
            var bid = $scope.calculate_npv($scope.auction_doc.NBUdiscountRate,
                                           $scope.get_annual_costs_reduction($scope.bidder_id),
                                           data.data.yearlyPayments,
                                           data.data.contractDurationYear,
                                           data.data.yearlyPaymentsPercentage,
                                           data.contractDurationDay
                                         )
            if ((bid <= ($scope.max_bid_amount() * 0.1))) {
              var msg_id = Math.random();
              $rootScope.alerts.push({
                msg_id: msg_id,
                type: 'warning',
                msg: 'Your bid appears too low'
              });
            }
            var msg_id = Math.random();
            if (yearlyPayments == -1) {
              $rootScope.alerts = [];
              $scope.allow_bidding = true;
              $log.info({
                message: "Handle cancel bid response on post bid"
              });
              $rootScope.alerts.push({
                msg_id: msg_id,
                type: 'success',
                msg: 'Bid canceled'
              });
              $log.info({
                message: "Handle cancel bid response on post bid"
              });
              // XXX TODO Check
              $rootScope.form.yearlyPayments = "";
              $rootScope.form.yearlyPaymentsPercentage = "";
              $rootScope.form.contractDurationDays = "";
              $rootScope.form.contractDurationYears = "";
              $rootScope.form.full_price = '';
              $rootScope.form.bid_temp = '';

            } else {
              $log.info({
                message: "Handle success response on post bid",
                bid_data: data.data
              });
              $rootScope.alerts.push({
                msg_id: msg_id,
                type: 'success',
                msg: 'Bid placed'
              });
              $scope.allow_bidding = false;
            }
            $scope.auto_close_alert(msg_id);
          }
        })
          .error(function(data, status, headers, config) {
            $log.info({
              message: "Handle error on post bid",
              bid_data: status
            });
            if ($scope.post_bid_timeout){
              $timeout.cancel($scope.post_bid_timeout);
              delete $scope.post_bid_timeout;
            }
            if (status == 401) {
              $rootScope.alerts.push({
                msg_id: Math.random(),
                type: 'danger',
                msg: 'Ability to submit bids has been lost. Wait until page reloads, and retry.'
              });
              $log.error({
                message: "Ability to submit bids has been lost. Wait until page reloads, and retry."
              });
              relogin = function() {
                var relogin_amount = $scope.calculate_npv($scope.auction_doc.NBUdiscountRate,
                                               annual_costs_reduction,
                                               data.data.yearlyPayments,
                                               data.data.contractDurationYear,
                                               data.data.yearlyPaymentsPercentage,
                                              data.contractDurationDay
                                             )
                window.location.replace(window.location.href + '/relogin?amount=' + $rootScope.relogin_amount);
              }
              $timeout(relogin, 3000);
            } else {
              $log.error({
                message: "Unhandled Error while post bid",
                error_data: data
              });
              $timeout($scope.post_bid, 2000);
            }
          });
      }
    };
    $scope.edit_bid = function() {
      $scope.allow_bidding = true;
    };
    $scope.max_bid_amount = function() {
      var amount = 0;
      if ((angular.isString($scope.bidder_id)) && (angular.isObject($scope.auction_doc))) {
        var current_stage_obj = $scope.auction_doc.stages[$scope.auction_doc.current_stage] || null;
        if ((angular.isObject(current_stage_obj)) && (current_stage_obj.amount || current_stage_obj.amount_features)) {
          minimalStep_currency = math.fraction(current_stage_obj.amount) * math.fraction($scope.auction_doc.minimalStep.amount) / math.fraction(100)
          if ($scope.bidder_coeficient && ($scope.auction_doc.auction_type || "default" == "meat")) {
            amount = math.fraction(current_stage_obj.amount_features) / $scope.bidder_coeficient + minimalStep_currency;
          } else {
            amount = math.fraction(current_stage_obj.amount) + minimalStep_currency;
          }
        }
      };
      if (amount < 0) {
        $scope.calculated_max_bid_amount = 0;
        return 0;
      }
      $scope.calculated_max_bid_amount = amount;
      return amount;
    };
    $scope.calculate_minimal_bid_amount = function() {
      if ((angular.isObject($scope.auction_doc)) && (angular.isArray($scope.auction_doc.stages)) && (angular.isArray($scope.auction_doc.initial_bids))) {
        var bids = [];
        var filter_func;
        if ($scope.auction_doc.auction_type == 'meat') {
          filter_func = function(item, index) {
            if (!angular.isUndefined(item.amount_features)) {
              bids.push(item);
            }
          };
        } else {
          filter_func = function(item, index) {
            if (!angular.isUndefined(item.amount)) {
              bids.push(item);
            }
          };
        }
        $scope.auction_doc.stages.forEach(filter_func);
        $scope.auction_doc.initial_bids.forEach(filter_func);
        $scope.minimal_bid = bids.sort(function(a, b) {
          if ($scope.auction_doc.auction_type == 'meat') {
            var diff = math.fraction(a.amount_features) - math.fraction(b.amount_features);
          } else {
            var diff = a.amount - b.amount;
          }
          if (diff == 0) {
            return Date.parse(a.time || "") - Date.parse(b.time || "");
          }
          return diff;
        })[0];
      }
    };
    $scope.start_sync = function() {
      $scope.start_changes = new Date();
      $scope.changes = $scope.db.changes($scope.changes_options).on('change', function(resp) {
        $scope.restart_retries = AuctionConfig.restart_retries;
        if (resp.id == AuctionConfig.auction_doc_id) {
          $scope.replace_document(resp.doc);
          if ($scope.auction_doc.current_stage == ($scope.auction_doc.stages.length - 1)) {
            $scope.changes.cancel();
          }
        }
      }).on('error', function(err) {
        $log.error({
          message: "Changes error",
          error_data: err
        });
        $scope.end_changes = new Date();
        if ((($scope.end_changes - $scope.start_changes) > 40000)||($scope.force_heartbeat)) {
          $scope.force_heartbeat = true;
        } else {
          $scope.changes_options['heartbeat'] = false;
          $log.info({
            message: "Change heartbeat to false (Use timeout)",
            heartbeat: false
          });
        }
        $timeout(function() {
          if ($scope.restart_retries != AuctionConfig.restart_retries) {
            growl.warning('Internet connection is lost. Attempt to restart after 1 sec', {
              ttl: 1000
            });
          }
          $scope.restart_retries -= 1;
          if ($scope.restart_retries) {
            $log.debug({
              message: 'Restart feed pooling...'
            });
            $scope.restart_changes();
          } else {
            growl.error('Synchronization failed');
            $log.error({
              message: 'Synchronization failed'
            });
          }
        }, 1000);
      });
    };
    $scope.start_auction_process = function() {
      $scope.db.get(AuctionConfig.auction_doc_id, function(err, doc) {
        if (err) {
          if (err.status == 404) {
            $log.error({
              message: 'Not Found Error',
              error_data: err
            });
            $rootScope.document_not_found = true;
          } else {
            $log.error({
              message: 'Server Error',
              error_data: err
            });
            $scope.http_error_timeout = $scope.http_error_timeout * 2;
            $timeout(function() {
              $scope.start_auction_process();
            }, $scope.http_error_timeout);
          }
          return;
        }
        $scope.http_error_timeout = $scope.default_http_error_timeout;
        var params = AuctionUtils.parseQueryString(location.search);

        $scope.start_sync_event = $q.defer();
        if (doc.current_stage >= -1 && params.wait) {
    $log.info("login allowed " + doc.current_stage);
          $scope.follow_login_allowed = true;
          $log.info({message: 'client wait for login'});
        } else {
          $scope.follow_login_allowed = false;
        }
        $scope.title_ending = AuctionUtils.prepare_title_ending_data(doc, $scope.lang);
        $scope.replace_document(doc);
        $scope.document_exists = true;
        if (AuctionUtils.UnsupportedBrowser()) {
          $timeout(function() {
            $scope.unsupported_browser = true;
            growl.error($filter('translate')('Your browser is out of date, and this site may not work properly.') + '<a style="color: rgb(234, 4, 4); text-decoration: underline;" href="http://browser-update.org/uk/update.html">' + $filter('translate')('Learn how to update your browser.') + '</a>', {
              ttl: -1,
              disableCountDown: true
            });
          }, 500);
        };
        $scope.scroll_to_stage();
        if ($scope.auction_doc.current_stage != ($scope.auction_doc.stages.length - 1)) {
          if ($cookieStore.get('auctions_loggedin')||AuctionUtils.detectIE()) {
            $log.info({
              message: 'Start private session'
            });
            $scope.start_subscribe();
          } else {
            $log.info({
              message: 'Start anonymous session'
            });
            if ($scope.auction_doc.current_stage == - 1){
              $scope.$watch('start_changes_feed', function(newValue, oldValue){
                if(newValue && !($scope.sync)){
                  $log.info({
                    message: 'Start changes feed'
                  });
                  $scope.sync = $scope.start_sync();
                }
              });
            } else {
              $scope.start_sync_event.resolve('start');
            }
      $log.info("LOGIN ALLOWED " + $scope.follow_login_allowed);
            if (!$scope.follow_login_allowed) {
              $timeout(function() {
                growl.info($filter('translate')('You are an observer and cannot bid.'), {
                  ttl: -1,
                  disableCountDown: true
                });
              }, 500);
            }
          }
          $scope.restart_retries = AuctionConfig.restart_retries;
          $scope.start_sync_event.promise.then(function() {
            $scope.sync = $scope.start_sync();
          });
        } else {
          // TODO: CLEAR COOKIE
          $log.info({
            message: 'Auction ends already'
          });
        }
      });
    };
    $scope.restart_changes = function() {
      $scope.changes.cancel();
      $timeout(function() {
        $scope.start_sync();
      }, 1000);
    };
    $scope.replace_document = function(new_doc) {
      if ((angular.isUndefined($scope.auction_doc)) || (new_doc.current_stage - $scope.auction_doc.current_stage === 0) || (new_doc.current_stage === -1)) {
        if (angular.isUndefined($scope.auction_doc)) {
          $log.info({
            message: 'Change current_stage',
            current_stage: new_doc.current_stage,
            stages: (new_doc.stages || []).length - 1
          });
        }
        $scope.auction_doc = new_doc;
      } else {
        $log.info({
          message: 'Change current_stage',
          current_stage: new_doc.current_stage,
          stages: (new_doc.stages || []).length - 1
        });
        $rootScope.form.bid = null;
        $scope.allow_bidding = true;
        $scope.auction_doc = new_doc;
      }
      $scope.sync_times_with_server();
      $scope.calculate_rounds();
      $scope.calculate_minimal_bid_amount();
      $scope.scroll_to_stage();
      $scope.show_bids_form();

      $scope.$apply();
    };
    $scope.calculate_rounds = function(argument) {
      $scope.Rounds = [];
      $scope.auction_doc.stages.forEach(function(item, index) {
        if (item.type == 'pause') {
          $scope.Rounds.push(index);
        }
      });
    };
    $scope.scroll_to_stage = function() {
      AuctionUtils.scroll_to_stage($scope.auction_doc, $scope.Rounds);
    };
    $scope.array = function(int) {
      return new Array(int);
    };
    $scope.open_menu = function() {
      var modalInstance = $aside.open({
        templateUrl: 'templates/menu.html',
        controller: 'OffCanvasController',
        scope: $scope,
        size: 'lg',
        backdrop: true
      });
    };
    /* 2-WAY INPUT */
    // XXX TODO
    $scope.get_annual_costs_reduction = function(bidder_id){
      for (var initial_bid in $scope.auction_doc.initial_bids){
        if (bidder_id === $scope.auction_doc.initial_bids[initial_bid].bidder_id){
          return $scope.auction_doc.initial_bids[initial_bid].annualCostsReduction;
        }
      }
    }
    $scope.calculate_bid_temp = function() {
      $rootScope.form.bid_temp = Number(math.fraction(($rootScope.form.bid * 100).toFixed(), 100));
      $rootScope.form.full_price = $rootScope.form.bid_temp / $scope.bidder_coeficient;
      $log.debug("Set bid_temp:", $rootScope.form);
    };
    $scope.calculate_full_price_temp = function() {
      $rootScope.form.bid = (math.fix((math.fraction($rootScope.form.full_price) * $scope.bidder_coeficient) * 100)) / 100;
      $rootScope.form.full_price_temp = $rootScope.form.bid / $scope.bidder_coeficient;
    };
    $scope.set_bid_from_temp = function() {
      $rootScope.form.bid = $rootScope.form.bid_temp;
      if ($rootScope.form.bid){
        $rootScope.form.BidsForm.bid.$setViewValue(math.format($rootScope.form.bid, {
          notation: 'fixed',
          precision: 2
        }).replace(/(\d)(?=(\d{3})+\.)/g, '$1 ').replace(/\./g, ","));
      }
    };
    $scope.calculate_yearly_payments_temp = function(){
      $rootScope.form.yearlyPayments_temp = Number(math.fraction(($rootScope.form.yearlyPayments * 100).toFixed(), 100))
      $rootScope.form.yearlyPaymentsPercentage = parseFloat((($rootScope.form.yearlyPayments_temp / $scope.get_annual_costs_reduction($scope.bidder_id)) * 100).toFixed(3));
      $rootScope.form.BidsForm.yearlyPaymentsPercentage.$setViewValue(math.format($rootScope.form.yearlyPaymentsPercentage, {
        notation: 'fixed',
        precision: 3
      }).replace(/(\d)(?=(\d{4})+\.)/g, '$1 ').replace(/\./g, ","));
    }
    $scope.calculate_yearly_payments_percentage_temp = function(){
      $rootScope.form.yearlyPayments = math.fraction($rootScope.form.yearlyPaymentsPercentage, 100) * $scope.get_annual_costs_reduction($scope.bidder_id);
      $rootScope.form.yearlyPaymentsPercentage_temp = parseFloat((($rootScope.form.yearlyPayments / $scope.get_annual_costs_reduction($scope.bidder_id)) * 100).toFixed(3));
    }
    $scope.set_yearly_payments_percentage_from_temp = function(){
      $rootScope.form.yearlyPaymentsPercentage = $rootScope.form.yearlyPaymentsPercentage_temp;
      if ($rootScope.form.yearlyPaymentsPercentage){
        $rootScope.form.BidsForm.yearlyPaymentsPercentage.$setViewValue(math.format($rootScope.form.yearlyPaymentsPercentage, {
          notation: 'fixed',
          precision: 3
        }).replace(/(\d)(?=(\d{4})+\.)/g, '$1 ').replace(/\./g, ","));
      }
    }
    $scope.start();
}]);
