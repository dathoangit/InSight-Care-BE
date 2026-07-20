import { type HospitalFloorLabel } from '../../layout/constants/floor-labels';

export interface IHospitalFloorLayout {
  floor: HospitalFloorLabel;
  rooms: string[];
}

export const HOSPITAL_LAYOUT: IHospitalFloorLayout[] = [
  {
    floor: '1-9',
    rooms: ['1', '1', '2', '2', '3', '3', '5A', '5A', '5B', '6', '7', '8', '9'],
  },
  {
    floor: 'CC-15',
    rooms: [
      'CC',
      'CC',
      'CC',
      'CC',
      '10',
      '10',
      '11',
      '11',
      '12A',
      '12A',
      '12B',
      '12B',
      '15A',
      '15A',
      '15B',
      '15B',
    ],
  },
  {
    floor: '16-25',
    rooms: [
      '16',
      '17',
      '18',
      '18',
      '19',
      '19',
      '20',
      '20',
      '21',
      '21',
      '22',
      '22',
      '23',
      '23',
      '24',
      '24',
      '25',
      '25',
    ],
  },
  {
    floor: '26-31',
    rooms: [
      '26',
      '26',
      '27',
      '27',
      '28',
      '28',
      '29',
      '29',
      '30',
      '30',
      '31',
      '31',
    ],
  },
];
