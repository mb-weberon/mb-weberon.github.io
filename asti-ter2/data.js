var APP_DATA = {
  "scenes": [
    {
      "id": "0-front-entrance",
      "name": "Front Entrance",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": -0.047546578229543,
        "pitch": 0.004005395359115482,
        "fov": 1.9642033428203352
      },
      "linkHotspots": [
        {
          "yaw": -1.0195270776879148,
          "pitch": -0.15912161052231966,
          "rotation": 10.210176124166829,
          "target": "1-front-door"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "1-front-door",
      "name": "Front Door",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": 1.6299334660388753,
        "pitch": 0.034806350017252186,
        "fov": 1.9642033428203352
      },
      "linkHotspots": [
        {
          "yaw": 2.447864846955885,
          "pitch": 0.06877175097347177,
          "rotation": 1.5707963267948966,
          "target": "0-front-entrance"
        },
        {
          "yaw": 1.5167290171092862,
          "pitch": -0.026259440827534064,
          "rotation": 10.995574287564278,
          "target": "3-guest-bedroom"
        },
        {
          "yaw": 0.7322693618694913,
          "pitch": -0.15932053116462086,
          "rotation": 5.497787143782138,
          "target": "5-dining"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "2-guest-bedroom-window",
      "name": "Guest Bedroom Window",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": -2.37689495029724,
        "pitch": 0.09779022427102291,
        "fov": 1.3185972797531151
      },
      "linkHotspots": [
        {
          "yaw": 2.954054377849702,
          "pitch": -0.00746036724020982,
          "rotation": 4.71238898038469,
          "target": "4-guest-bathroom"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "3-guest-bedroom",
      "name": "Guest Bedroom",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": 2.893166977320856,
        "pitch": -0.006275494893783318,
        "fov": 1.3185972797531151
      },
      "linkHotspots": [
        {
          "yaw": -2.420496146406066,
          "pitch": -0.07537014399309783,
          "rotation": 7.853981633974483,
          "target": "4-guest-bathroom"
        },
        {
          "yaw": -3.081013329337148,
          "pitch": -0.01477379204921192,
          "rotation": 10.995574287564278,
          "target": "1-front-door"
        },
        {
          "yaw": 2.2219479272514207,
          "pitch": -0.05811205791908591,
          "rotation": 4.71238898038469,
          "target": "2-guest-bedroom-window"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "4-guest-bathroom",
      "name": "Guest Bathroom",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": -0.0005635946246087542,
        "pitch": -0.014920795627155314,
        "fov": 1.9642033428203352
      },
      "linkHotspots": [
        {
          "yaw": 0.9174136022297326,
          "pitch": -0.08880916585185972,
          "rotation": 20.420352248333668,
          "target": "3-guest-bedroom"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "5-dining",
      "name": "Dining",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": 1.4983906536407678,
        "pitch": 0.011907060436241679,
        "fov": 1.639210670112654
      },
      "linkHotspots": [
        {
          "yaw": 0.6027054613963045,
          "pitch": 0.40252192205020165,
          "rotation": 5.497787143782138,
          "target": "6-kitchen"
        },
        {
          "yaw": 2.275607056515142,
          "pitch": 0.45436743408922453,
          "rotation": 2.356194490192345,
          "target": "10-living"
        },
        {
          "yaw": 0.7020993243057756,
          "pitch": 0.4865506911597297,
          "rotation": 14.922565104551524,
          "target": "1-front-door"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "6-kitchen",
      "name": "Kitchen",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": -2.533773292217713,
        "pitch": 0.1251635268625204,
        "fov": 1.639210670112654
      },
      "linkHotspots": [
        {
          "yaw": -2.9808716293083357,
          "pitch": -0.025715157745372252,
          "rotation": 10.210176124166829,
          "target": "8-laundry"
        },
        {
          "yaw": -2.1365360000868527,
          "pitch": 0.41539789818961737,
          "rotation": 12.566370614359176,
          "target": "7-kitchen-window"
        },
        {
          "yaw": 2.9546139360883563,
          "pitch": 0.030022769135497285,
          "rotation": 10.210176124166829,
          "target": "5-dining"
        },
        {
          "yaw": 3.080855008286851,
          "pitch": -0.1661131233400006,
          "rotation": 15.707963267948973,
          "target": "9-toilet"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "7-kitchen-window",
      "name": "Kitchen Window",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": 1.2239038705514105,
        "pitch": 0.11971987651217475,
        "fov": 1.639210670112654
      },
      "linkHotspots": [
        {
          "yaw": 2.092687251600662,
          "pitch": -0.18945186734206487,
          "rotation": 3.141592653589793,
          "target": "9-toilet"
        },
        {
          "yaw": 1.0306828525269864,
          "pitch": 0.43206253499822544,
          "rotation": 7.0685834705770345,
          "target": "5-dining"
        },
        {
          "yaw": 2.19393497012811,
          "pitch": 0.035102607464933655,
          "rotation": 7.853981633974483,
          "target": "8-laundry"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "8-laundry",
      "name": "Laundry",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": -0.02912675268326126,
        "pitch": 0.008614926942176027,
        "fov": 1.9642033428203352
      },
      "linkHotspots": [
        {
          "yaw": -1.0027829250554312,
          "pitch": -0.19990110176107834,
          "rotation": 4.71238898038469,
          "target": "9-toilet"
        },
        {
          "yaw": 0.8754338727278554,
          "pitch": -0.2504412139830201,
          "rotation": 2.356194490192345,
          "target": "6-kitchen"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "9-toilet",
      "name": "Toilet",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": -2.9875812761909977,
        "pitch": -0.079375038762306,
        "fov": 1.639210670112654
      },
      "linkHotspots": [
        {
          "yaw": -2.135880575196083,
          "pitch": -0.17206201092863438,
          "rotation": 8.63937979737193,
          "target": "8-laundry"
        },
        {
          "yaw": 2.4950051152966584,
          "pitch": -0.171778220418755,
          "rotation": 17.27875959474387,
          "target": "6-kitchen"
        },
        {
          "yaw": 2.717120563723565,
          "pitch": -0.26254763943443393,
          "rotation": 11.780972450961727,
          "target": "5-dining"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "10-living",
      "name": "Living",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": -1.2018470097395912,
        "pitch": 0.038932064571474356,
        "fov": 1.639210670112654
      },
      "linkHotspots": [
        {
          "yaw": -0.2171780311452398,
          "pitch": 0.4301683585776459,
          "rotation": 14.922565104551524,
          "target": "5-dining"
        },
        {
          "yaw": -1.2260540722108821,
          "pitch": 0.49647342699963914,
          "rotation": 18.84955592153877,
          "target": "11-living-window"
        },
        {
          "yaw": -0.7833636347355863,
          "pitch": 0.4885279350344387,
          "rotation": 13.351768777756625,
          "target": "12-balcony"
        },
        {
          "yaw": -0.18737039944460854,
          "pitch": 0.2924237008778565,
          "rotation": 7.0685834705770345,
          "target": "13-stairs"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "11-living-window",
      "name": "Living Window",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": 1.3280702213027542,
        "pitch": 0.014587981573340514,
        "fov": 1.5707963267948966
      },
      "linkHotspots": [
        {
          "yaw": 1.9006136756631804,
          "pitch": 0.43055815329899083,
          "rotation": 2.356194490192345,
          "target": "10-living"
        },
        {
          "yaw": 1.9415808995307833,
          "pitch": 0.2940984281061283,
          "rotation": 8.63937979737193,
          "target": "5-dining"
        },
        {
          "yaw": 0.5110935970143089,
          "pitch": -0.20998124891235648,
          "rotation": 7.853981633974483,
          "target": "13-stairs"
        },
        {
          "yaw": 0.3294298586707196,
          "pitch": -0.2474522801489467,
          "rotation": 3.9269908169872414,
          "target": "12-balcony"
        },
        {
          "yaw": 1.7681019374667306,
          "pitch": 0.29875558454675044,
          "rotation": 10.995574287564278,
          "target": "1-front-door"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "12-balcony",
      "name": "Balcony",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": -2.0169951299574294,
        "pitch": 0.1359505972205941,
        "fov": 1.639210670112654
      },
      "linkHotspots": [
        {
          "yaw": -2.8681286279795675,
          "pitch": -0.09978371552575815,
          "rotation": 4.71238898038469,
          "target": "11-living-window"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "13-stairs",
      "name": "Stairs",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": -3.053906135286816,
        "pitch": -0.004756847612597426,
        "fov": 1.639210670112654
      },
      "linkHotspots": [
        {
          "yaw": -2.533348015312015,
          "pitch": 0.3938665422615042,
          "rotation": 23.561944901923464,
          "target": "10-living"
        },
        {
          "yaw": -2.1268607337670744,
          "pitch": -0.13519791270123882,
          "rotation": 2.356194490192345,
          "target": "12-balcony"
        },
        {
          "yaw": 2.4426200523498522,
          "pitch": -0.24311025718683332,
          "rotation": 11.780972450961727,
          "target": "14-landing"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "14-landing",
      "name": "Landing",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "pitch": 0,
        "yaw": 0,
        "fov": 1.5707963267948966
      },
      "linkHotspots": [
        {
          "yaw": 0.05128244899572998,
          "pitch": 0.6094000993763515,
          "rotation": 19.63495408493622,
          "target": "15-bedroom-2"
        },
        {
          "yaw": -0.46796667629059385,
          "pitch": 0.5691862735694091,
          "rotation": 3.9269908169872414,
          "target": "13-stairs"
        },
        {
          "yaw": 0.4962207622911059,
          "pitch": 0.5532215375032763,
          "rotation": 2.356194490192345,
          "target": "17-main-bedroom"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "15-bedroom-2",
      "name": "Bedroom 2",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": -1.3841746367298455,
        "pitch": 0.05288296903865408,
        "fov": 1.3848081938437478
      },
      "linkHotspots": [
        {
          "yaw": -0.5761250982006452,
          "pitch": 0.28670345361337013,
          "rotation": 5.497787143782138,
          "target": "16-bathroom-2"
        },
        {
          "yaw": -2.249429259883513,
          "pitch": 0.013975405528775298,
          "rotation": 10.210176124166829,
          "target": "14-landing"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "16-bathroom-2",
      "name": "Bathroom 2",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": 0.11263331155320344,
        "pitch": 0.06566153361033855,
        "fov": 1.7087036238960316
      },
      "linkHotspots": [
        {
          "yaw": 0.6554235804147588,
          "pitch": -0.12805370881497424,
          "rotation": 1.5707963267948966,
          "target": "15-bedroom-2"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "17-main-bedroom",
      "name": "Main Bedroom",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": -2.676494461829984,
        "pitch": 0.07956528539176944,
        "fov": 1.3848081938437478
      },
      "linkHotspots": [
        {
          "yaw": 3.124776345475918,
          "pitch": 0.6334482614942072,
          "rotation": 3.9269908169872414,
          "target": "14-landing"
        },
        {
          "yaw": -1.786760439840812,
          "pitch": 0.464931232063039,
          "rotation": 7.0685834705770345,
          "target": "18-main-bedroom-window"
        },
        {
          "yaw": -3.020332658025337,
          "pitch": 0.4674840717509259,
          "rotation": 4.71238898038469,
          "target": "19-main-bath-entry"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "18-main-bedroom-window",
      "name": "Main Bedroom Window",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": -0.5230958808060961,
        "pitch": -0.020632520150568823,
        "fov": 1.3848081938437478
      },
      "linkHotspots": [
        {
          "yaw": -0.588416539786401,
          "pitch": 0.20639351509658965,
          "rotation": 18.06415775814132,
          "target": "14-landing"
        },
        {
          "yaw": 0.4296812205269642,
          "pitch": 0.31300437260488323,
          "rotation": 9.42477796076938,
          "target": "17-main-bedroom"
        },
        {
          "yaw": 0.41630803787478854,
          "pitch": 0.22870088016524726,
          "rotation": 33.772121026090296,
          "target": "19-main-bath-entry"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "19-main-bath-entry",
      "name": "Main Bath Entry",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": 1.5934360598073507,
        "pitch": 0.08267522147238004,
        "fov": 1.3848081938437478
      },
      "linkHotspots": [
        {
          "yaw": 1.883235556778847,
          "pitch": 0.5000287086005812,
          "rotation": 0.7853981633974483,
          "target": "14-landing"
        },
        {
          "yaw": 0.9773898231495473,
          "pitch": 0.4631598500299887,
          "rotation": 4.71238898038469,
          "target": "18-main-bedroom-window"
        },
        {
          "yaw": 1.9188368061863015,
          "pitch": 0.6473002196218367,
          "rotation": 2.356194490192345,
          "target": "20-main-bathroom"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "20-main-bathroom",
      "name": "Main Bathroom",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": -2.965155778496481,
        "pitch": 0.013888392103146074,
        "fov": 1.3185972797531151
      },
      "linkHotspots": [
        {
          "yaw": -2.732025778428593,
          "pitch": 0.3877309558158242,
          "rotation": 8.63937979737193,
          "target": "19-main-bath-entry"
        },
        {
          "yaw": -2.593207252560992,
          "pitch": 0.5731963810425391,
          "rotation": 3.141592653589793,
          "target": "21-walk-in-closet"
        }
      ],
      "infoHotspots": []
    },
    {
      "id": "21-walk-in-closet",
      "name": "Walk-in Closet",
      "levels": [
        {
          "tileSize": 256,
          "size": 256,
          "fallbackOnly": true
        },
        {
          "tileSize": 512,
          "size": 512
        },
        {
          "tileSize": 512,
          "size": 1024
        },
        {
          "tileSize": 512,
          "size": 2048
        }
      ],
      "faceSize": 1344,
      "initialViewParameters": {
        "yaw": -2.739180846848729,
        "pitch": 0.03822223123085422,
        "fov": 1.5707963267948966
      },
      "linkHotspots": [
        {
          "yaw": 2.818173761378109,
          "pitch": 0.5916160304018732,
          "rotation": 0,
          "target": "20-main-bathroom"
        },
        {
          "yaw": 2.818749207027423,
          "pitch": 0.3320614541570386,
          "rotation": 6.283185307179586,
          "target": "19-main-bath-entry"
        }
      ],
      "infoHotspots": []
    }
  ],
  "name": "asti ter autotone",
  "settings": {
    "mouseViewMode": "drag",
    "autorotateEnabled": false,
    "fullscreenButton": true,
    "viewControlButtons": true
  }
};
