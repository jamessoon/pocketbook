import {
  IconArmchair, IconBallVolleyball, IconBarbell, IconBasket, IconBed,
  IconBook, IconBooks, IconBuildingBank, IconBuildingCommunity, IconBulb,
  IconCar, IconCat, IconCoffee, IconCreditCard, IconDeviceGamepad2,
  IconDeviceTv, IconDots, IconDroplet, IconFirstAidKit, IconGasStation,
  IconGift, IconGlass, IconHeartHandshake, IconHeartbeat, IconHome, IconKey,
  IconRectangle, IconParking, IconPhone, IconPill, IconPlane, IconReceiptTax,
  IconSchool, IconShieldCheck, IconShirt, IconShoppingBag, IconSparkles,
  IconToolsKitchen2, IconTrain, IconUsersGroup, IconWifi, IconBabyCarriage,
  type TablerIcon,
} from '@tabler/icons-react'

export const palette = [
  ['Violet', '#8059AD'], ['Blue', '#376BB3'], ['Orange', '#B75B25'],
  ['Indigo', '#5260AD'], ['Purple', '#92549F'], ['Green', '#3C8052'],
  ['Rose', '#AF5472'], ['Ochre', '#957029'], ['Amber', '#AA6E16'],
  ['Teal', '#258078'], ['Cyan', '#267C91'], ['Sky blue', '#367EAD'],
  ['Red', '#B04F50'], ['Plum', '#865B8C'],
] as const

// Each slug is a persisted value shared with the household seed and widget.
const choices: [string, string, TablerIcon, number][] = [
  ['shopping-bag', 'Shopping bag', IconShoppingBag, 0],
  ['phone', 'Phone · communication', IconPhone, 1],
  ['tools-kitchen-2', 'Fork and knife · food and dining', IconToolsKitchen2, 2],
  ['book', 'Open book · education', IconBook, 3],
  ['movie', 'Clapperboard · entertainment', IconRectangle, 4],
  ['basket', 'Basket · groceries', IconBasket, 5],
  ['gift', 'Gift · occasional', IconGift, 6],
  ['home', 'House · home', IconHome, 7],
  ['cat', 'Cat · pets', IconCat, 8],
  ['ball-volleyball', 'Volleyball · sport', IconBallVolleyball, 9],
  ['taxi', 'Taxi · transport', IconCar, 10],
  ['plane', 'Plane · travel and flights', IconPlane, 11],
  ['heartbeat', 'Heartbeat · health', IconHeartbeat, 12],
  ['users-group', 'People · family', IconUsersGroup, 13],
  ['coffee', 'Coffee', IconCoffee, 7], ['glass', 'Drink', IconGlass, 10],
  ['car', 'Car', IconCar, 10], ['train', 'Train', IconTrain, 1],
  ['gas-station', 'Fuel', IconGasStation, 2], ['parking', 'Parking', IconParking, 1],
  ['key', 'Key · rent', IconKey, 7], ['armchair', 'Furniture', IconArmchair, 13],
  ['building-community', 'Utilities', IconBuildingCommunity, 7],
  ['bulb', 'Electricity', IconBulb, 8], ['droplet', 'Water', IconDroplet, 11],
  ['wifi', 'Internet', IconWifi, 3], ['device-tv', 'Subscriptions', IconDeviceTv, 4],
  ['shield-check', 'Insurance', IconShieldCheck, 9], ['receipt-tax', 'Tax', IconReceiptTax, 7],
  ['pill', 'Medicine', IconPill, 12], ['first-aid-kit', 'First aid', IconFirstAidKit, 12],
  ['barbell', 'Fitness', IconBarbell, 9], ['baby-carriage', 'Kids', IconBabyCarriage, 6],
  ['school', 'School', IconSchool, 3], ['books', 'Books', IconBooks, 3],
  ['shirt', 'Clothing', IconShirt, 0], ['sparkles', 'Beauty', IconSparkles, 6],
  ['device-gamepad-2', 'Games', IconDeviceGamepad2, 4], ['bed', 'Hotel', IconBed, 11],
  ['heart-handshake', 'Charity', IconHeartHandshake, 6],
  ['building-bank', 'Bank fees', IconBuildingBank, 1], ['credit-card', 'Card', IconCreditCard, 1],
  ['dots', 'Other', IconDots, 13],
]

export const iconChoices = choices.map(([name, label, component, colorIndex]) => ({
  name, label, component, color: palette[colorIndex][1],
}))
const icons = new Map(iconChoices.map(choice => [choice.name, choice.component]))

export function CategoryIcon({ name, size = 20 }: { name: string; size?: number }) {
  const Symbol = icons.get(name) ?? IconDots
  return (
    <Symbol size={size} stroke={1.8} aria-hidden="true" focusable="false">
      {name === 'taxi' && <path d="M8.5 6l.65-2.5h4.2L14 6" />}
      {name === 'movie' && <path d="M3 10h18M6 5l3 5m3-5 3 5m3-5 3 5" />}
    </Symbol>
  )
}
